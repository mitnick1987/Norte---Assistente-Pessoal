import type { JobRepository } from '../../core/scheduler/index.js';
import type { ItemService } from '../tasks/public/index.js';
import type { TriageItem } from './domain/index.js';

export interface CapturedItem {
  readonly id: number;
  readonly title: string;
}

/**
 * Ponte entre a triagem e o task-store (RF-01): toda escrita passa pelo
 * `ItemService` (que por sua vez só grava via repository do módulo tasks) —
 * nunca SQL direto, mesmo estando em outro módulo (ARCHITECTURE.md §2).
 *
 * Item com dueAt agenda um job `reminder` avulso na tabela jobs (RF-03):
 * mesmo mecanismo de jobs+template da FEAT-001, sem depender de `chains`
 * (Decisões tomadas da FEAT-002).
 */
export class CaptureService {
  constructor(
    private readonly itemService: ItemService,
    private readonly jobRepository: JobRepository,
  ) {}

  /**
   * `sourceMessageId` é a chave de idempotência do reprocessamento (ADR-018):
   * se o processo morreu depois de gravar os itens mas antes de marcar a
   * mensagem como `processed`, a varredura de recuperação chama isto de novo
   * — sem o vínculo, cada retry duplicaria os itens no task-store (fonte da
   * verdade corrompida, inaceitável mesmo que a segunda confirmação ao
   * usuário seja tolerada pela ADR). Com o vínculo, a segunda chamada é
   * um no-op de gravação.
   */
  captureItems(items: readonly TriageItem[], sourceMessageId: number): CapturedItem[] {
    if (this.itemService.hasItemFromMessage(sourceMessageId)) {
      return [];
    }

    return items.map((item) => {
      const created = this.itemService.create({
        type: item.type,
        title: item.title,
        origin: 'texto',
        status: item.ambiguous ? 'inbox' : 'ativa',
        sourceMessageId,
        ...(item.dueAt ? { dueAt: new Date(item.dueAt) } : {}),
      });

      if (item.dueAt) {
        this.jobRepository.create({
          type: 'reminder',
          payload: { itemId: created.id, title: created.title },
          nextRunAt: new Date(item.dueAt),
        });
      }

      return { id: created.id, title: created.title };
    });
  }
}
