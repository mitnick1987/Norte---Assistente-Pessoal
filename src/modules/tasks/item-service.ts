import { assertTransition, parseRelativeDatePtBr, type ItemOrigin, type ItemPriority, type ItemRecord, type ItemType } from './domain/index.js';
import type { CreateItemInput, ItemsRepository } from './items-repository.js';

export class ItemNotFoundError extends Error {
  constructor(id: number) {
    super(`item ${id} não encontrado`);
    this.name = 'ItemNotFoundError';
  }
}

export interface CreateItemParams {
  readonly type: ItemType;
  readonly title: string;
  readonly origin: ItemOrigin;
  readonly priority?: ItemPriority;
  readonly dueAt?: Date;
  /** Classificação ambígua cai em inbox (RF-01) — quem chama decide, o serviço só aceita o status inicial que fizer sentido. */
  readonly status?: 'inbox' | 'ativa';
  /** Vínculo com a mensagem de origem (ADR-018) — usado pela varredura de recuperação para não duplicar gravação. */
  readonly sourceMessageId?: number;
  /** Posição do item dentro da extração da triagem (ADR-018) — idempotência granular por item, não só por mensagem. */
  readonly sourceItemIndex?: number;
}

export interface ListItemsParams {
  readonly includeInbox?: boolean;
}

/**
 * Única porta de escrita de `items` além do repository cru — toda transição
 * de estado (RF-07, ADR-009) passa por aqui, nunca por UPDATE direto fora
 * deste serviço. `now` é sempre injetado: nenhuma chamada a `new Date()` no
 * cálculo de "adia" (TESTING.md §7).
 */
export class ItemService {
  constructor(
    private readonly repository: ItemsRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  create(params: CreateItemParams): ItemRecord {
    const input: CreateItemInput = {
      type: params.type,
      title: params.title,
      origin: params.origin,
      status: params.status ?? 'ativa',
      ...(params.priority !== undefined ? { priority: params.priority } : {}),
      ...(params.dueAt !== undefined ? { dueAt: params.dueAt } : {}),
      ...(params.sourceMessageId !== undefined ? { sourceMessageId: params.sourceMessageId } : {}),
      ...(params.sourceItemIndex !== undefined ? { sourceItemIndex: params.sourceItemIndex } : {}),
    };
    return this.repository.create(input);
  }

  /** Idempotência granular por item (ADR-018): quais posições da extração dessa mensagem já foram gravadas. */
  findCapturedItemIndexes(sourceMessageId: number): Set<number> {
    return this.repository.findSourceItemIndexes(sourceMessageId);
  }

  private getOrThrow(id: number): ItemRecord {
    const item = this.repository.findById(id);
    if (!item) throw new ItemNotFoundError(id);
    return item;
  }

  complete(id: number): ItemRecord {
    const item = this.getOrThrow(id);
    assertTransition(item.status, 'feita');
    return this.repository.updateStatus(id, 'feita');
  }

  /**
   * Dropar é sempre lógico (ADR-009) — a coluna `status` vira `dropada`,
   * nunca um DELETE. Reversível por decisão de produto ("dropar sem culpa").
   */
  drop(id: number): ItemRecord {
    const item = this.getOrThrow(id);
    assertTransition(item.status, 'dropada');
    return this.repository.updateStatus(id, 'dropada');
  }

  /**
   * Sem tool nem command nesta feature — arquivamento automático é
   * `modules/hygiene` (RF-11, feature futura, fora de escopo aqui). O
   * serviço já cobre a transição porque as regras de estado do domínio
   * (item.ts) são o contrato único, independente de quem vai acioná-la.
   */
  archive(id: number): ItemRecord {
    const item = this.getOrThrow(id);
    assertTransition(item.status, 'arquivada');
    return this.repository.updateStatus(id, 'arquivada');
  }

  /**
   * "adia [quando]" (RF-07): parsing de data relativa em PT-BR resolvido em
   * America/Sao_Paulo. Texto sem data reconhecível não adia nada — quem
   * chama decide como responder (nunca inventa uma data arbitrária).
   */
  snoozeByText(id: number, relativeDateText: string): ItemRecord | undefined {
    const item = this.getOrThrow(id);
    assertTransition(item.status, 'adiada');

    const parsed = parseRelativeDatePtBr(relativeDateText, this.now());
    if (!parsed) return undefined;

    return this.repository.snooze(id, parsed.dueAt);
  }

  list(params: ListItemsParams = {}): ItemRecord[] {
    const activeStatuses = ['ativa', 'em_andamento', 'adiada'] as const;
    const statuses = params.includeInbox ? [...activeStatuses, 'inbox' as const] : activeStatuses;
    return this.repository.list({ statuses });
  }

  findMostRecentActive(): ItemRecord | undefined {
    return this.repository.findMostRecentActive();
  }
}
