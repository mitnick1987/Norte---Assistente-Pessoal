import { EventNotFoundError, type EventRecord } from './domain/index.js';
import type { CreateEventInput, EventsRepository } from './events-repository.js';

export interface CreateEventParams {
  readonly itemId: number;
  readonly title: string;
  readonly startAt: Date;
  readonly endAt?: Date;
  readonly local?: string;
  readonly deslocamentoMin: number;
  readonly gcalId?: string;
}

/**
 * CRUD de domínio de `events`, espelhando `ItemService` (FEAT-004, Decisões
 * tomadas: `events` é dado do task-store, não lógica de cadeia). Não sabe
 * nada sobre jobs/reminders — quem orquestra a cadeia a partir do evento é
 * `modules/chains`, reagindo aos eventos que `ItemService` publica no bus.
 */
export class EventService {
  constructor(private readonly repository: EventsRepository) {}

  create(params: CreateEventParams): EventRecord {
    const input: CreateEventInput = {
      itemId: params.itemId,
      title: params.title,
      startAt: params.startAt,
      deslocamentoMin: params.deslocamentoMin,
      ...(params.endAt !== undefined ? { endAt: params.endAt } : {}),
      ...(params.local !== undefined ? { local: params.local } : {}),
      ...(params.gcalId !== undefined ? { gcalId: params.gcalId } : {}),
    };
    return this.repository.create(input);
  }

  findActiveByItemId(itemId: number): EventRecord | undefined {
    return this.repository.findActiveByItemId(itemId);
  }

  /** Deduplicação da sincronização de leitura (FEAT-005): evento do Google já visto não gera `event` interno nem cadeia de novo. */
  findByGcalId(gcalId: string): EventRecord | undefined {
    return this.repository.findByGcalId(gcalId);
  }

  /** Grava o `gcal_id` retornado pela API do Google após criar o evento remoto — chave de idempotência de `create_event` (FEAT-005). */
  setGcalId(id: number, gcalId: string): EventRecord {
    return this.repository.setGcalId(id, gcalId);
  }

  /** Marcado depois que a cadeia inteira foi gerada com sucesso — evita regenerar cadeia parcial em caso de falha no meio da expansão. */
  markCadeiaGerada(id: number): void {
    this.repository.markCadeiaGerada(id);
  }

  /**
   * Cancelamento é sempre lógico (ADR-009). Idempotente por natureza: chamar
   * duas vezes sobre o mesmo evento só reafirma `cancelado`, nunca lança —
   * quem decide se cancela é o chamador (drop do item, reagendamento).
   */
  cancel(id: number): EventRecord {
    const event = this.repository.findById(id);
    if (!event) throw new EventNotFoundError(id);
    return this.repository.cancel(id);
  }

  /** Cancela o evento ativo do item, se existir — no-op quando o item nunca teve evento (compromisso sem hora resolvida, ou item de outro tipo). */
  cancelActiveForItem(itemId: number): EventRecord | undefined {
    const active = this.repository.findActiveByItemId(itemId);
    if (!active) return undefined;
    return this.repository.cancel(active.id);
  }
}
