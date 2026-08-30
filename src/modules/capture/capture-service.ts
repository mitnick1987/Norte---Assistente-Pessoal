import type { Database } from 'better-sqlite3';
import type { JobRepository } from '../../core/scheduler/index.js';
import { parseRelativeDatePtBr, type ItemService } from '../tasks/public/index.js';
import type { TriageItem } from './domain/index.js';

export interface CapturedItem {
  readonly id: number;
  readonly title: string;
  /** `true` quando o item tinha `dueExpression` mas o parser não reconheceu — usado para a confirmação avisar que não entendeu a data, sem perguntar estrutura. */
  readonly dueExpressionUnresolved: boolean;
}

/**
 * Ponte entre a triagem e o task-store (RF-01): toda escrita passa pelo
 * `ItemService` (que por sua vez só grava via repository do módulo tasks) —
 * nunca SQL direto, mesmo estando em outro módulo (ARCHITECTURE.md §2).
 *
 * Item com dueAt agenda um job `reminder` avulso na tabela jobs (RF-03):
 * mesmo mecanismo de jobs+template da FEAT-001, sem depender de `chains`
 * (Decisões tomadas da FEAT-002).
 *
 * `db` é usado só para abrir a transação que engloba item+job de uma mesma
 * posição (better-sqlite3: mesma conexão do `ItemService`/`JobRepository`,
 * ambos passados de fora) — o serviço continua sem SQL direto, a transação
 * só orquestra as duas escritas que já existiam.
 */
export class CaptureService {
  constructor(
    private readonly itemService: ItemService,
    private readonly jobRepository: JobRepository,
    private readonly db: Database,
  ) {}

  /**
   * `sourceMessageId` + `source_item_index` (posição do item na extração,
   * 0-based) é a chave de idempotência do reprocessamento (ADR-018),
   * GRANULAR POR ITEM: uma captura de N itens que crashou entre o item 0 e o
   * item 1 deixava a varredura ver "já existe item dessa mensagem" e pular
   * 1..N-1 para sempre (perda parcial permanente) — agora ela só pula os
   * índices já gravados e completa o resto. Item+job de uma mesma posição
   * são gravados numa única transação: crash entre os dois nunca deixa um
   * item órfão sem lembrete (o retry refaz a posição inteira).
   *
   * `now` resolve `dueExpression` (ADR-006): o Haiku devolve a expressão
   * relativa em PT-BR, nunca uma data absoluta — quem calcula é sempre o
   * backend, determinístico e testável, nunca o modelo (ele não tem como
   * saber que dia é hoje). Expressão que o parser não reconhece não vira
   * dueAt nenhum: o item vai pra inbox e a confirmação avisa que não
   * entendeu a data, sem fazer pergunta de estrutura.
   */
  captureItems(items: readonly TriageItem[], sourceMessageId: number, now: Date): CapturedItem[] {
    const alreadyCaptured = this.itemService.findCapturedItemIndexes(sourceMessageId);

    const captureOne = this.db.transaction((item: TriageItem, sourceItemIndex: number): CapturedItem => {
      const parsed = item.dueExpression ? parseRelativeDatePtBr(item.dueExpression, now) : undefined;
      const dueExpressionUnresolved = Boolean(item.dueExpression) && !parsed;

      const created = this.itemService.create({
        type: item.type,
        title: item.title,
        origin: 'texto',
        status: item.ambiguous || dueExpressionUnresolved ? 'inbox' : 'ativa',
        sourceMessageId,
        sourceItemIndex,
        ...(parsed ? { dueAt: parsed.dueAt } : {}),
      });

      if (parsed) {
        this.jobRepository.create({
          type: 'reminder',
          payload: { itemId: created.id, title: created.title },
          nextRunAt: parsed.dueAt,
        });
      }

      return { id: created.id, title: created.title, dueExpressionUnresolved };
    });

    const result: CapturedItem[] = [];
    items.forEach((item, sourceItemIndex) => {
      if (alreadyCaptured.has(sourceItemIndex)) return;
      result.push(captureOne(item, sourceItemIndex));
    });

    return result;
  }
}
