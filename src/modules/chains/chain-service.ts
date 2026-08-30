import type { JobRepository, JobRow } from '../../core/scheduler/index.js';
import type { EventService, EventRecord, ItemDroppedPayload, ItemRescheduledPayload } from '../tasks/public/index.js';
import { expandChain, type ChainSettings } from './domain/index.js';

const REMINDER_JOB_TYPE = 'reminder';

export interface ChainServiceDeps {
  readonly eventService: EventService;
  readonly jobRepository: JobRepository;
  /** Lida a cada chamada (não uma vez no boot) — o dono ajusta antecedência via settings sem reiniciar o processo. */
  readonly getSettings: () => ChainSettings;
  /** Injetável para teste — nunca `new Date()` direto no cálculo da cadeia (TESTING.md §7). */
  now?: () => Date;
}

interface ChainJobPayload {
  readonly eventId: number;
}

function parseChainJobPayload(payload: string): ChainJobPayload | undefined {
  try {
    const parsed = JSON.parse(payload) as Record<string, unknown>;
    return typeof parsed['eventId'] === 'number' ? { eventId: parsed['eventId'] } : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Orquestração de jobs da cadeia (FEAT-004, Decisões tomadas): `events` é
 * dado de `tasks`, mas quem decide quantos reminders existem, quando e como
 * cancelar/regenerar é este serviço — `chains` reage a `events` via o
 * contrato público de `tasks`, exatamente como `capture` reage a `items`.
 */
export class ChainService {
  private readonly now: () => Date;

  constructor(private readonly deps: ChainServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  /**
   * Cria a cadeia inteira para um evento recém-criado (chamado por
   * `capture-service.ts` no fluxo de captura de compromisso). Marca
   * `cadeiaGerada` só depois de todos os jobs gravados — evita marcar
   * sucesso parcial se algo falhar no meio da expansão.
   */
  scheduleForEvent(event: EventRecord): void {
    const reminders = expandChain(
      {
        eventId: event.id,
        itemId: event.itemId,
        title: event.title,
        startAt: new Date(event.startAt),
        deslocamentoMin: event.deslocamentoMin,
      },
      this.deps.getSettings(),
      this.now(),
    );

    for (const reminder of reminders) {
      this.deps.jobRepository.create({
        type: REMINDER_JOB_TYPE,
        nextRunAt: reminder.fireAt,
        payload: {
          eventId: reminder.eventId,
          itemId: reminder.itemId,
          title: reminder.title,
          startAt: reminder.startAt.toISOString(),
          deslocamentoMin: reminder.deslocamentoMin,
          tipoCadeia: reminder.tipoCadeia,
        },
      });
    }

    this.deps.eventService.markCadeiaGerada(event.id);
  }

  /**
   * Cancela todos os jobs `reminder` ainda `pending` da cadeia de um evento
   * — jobs já `sent`/`confirmed` permanecem como histórico (ARCHITECTURE.md
   * §6). Usa `cancelado`, não `failed`: drop/reagendamento é rotina, não
   * incidente de entrega, e a métrica de 99,5% do PRD deriva do status dos
   * jobs — contar isso como falha inflaria alerta por comportamento normal.
   */
  private cancelPendingJobsForEvent(eventId: number): void {
    const pendingReminders = this.deps.jobRepository.findPendingByType(REMINDER_JOB_TYPE);
    for (const job of pendingReminders) {
      if (belongsToEvent(job, eventId)) {
        this.deps.jobRepository.markCancelled(job.id);
      }
    }
  }

  /** `item.dropped`: cancela o evento ativo do item (se houver) e toda a cadeia pendente associada. No-op para item que nunca teve evento. */
  async onItemDropped(payload: ItemDroppedPayload): Promise<void> {
    const event = this.deps.eventService.cancelActiveForItem(payload.itemId);
    if (!event) return;
    this.cancelPendingJobsForEvent(event.id);
  }

  /**
   * `item.rescheduled`: cancela a cadeia antiga por completo e cria uma
   * cadeia nova a partir da nova data (Decisões tomadas da FEAT-004) — nunca
   * edita `fire_at` de job existente in-place, pra manter o rastro de
   * auditoria job → outbox → 2xx → `delivered_at` coerente.
   */
  async onItemRescheduled(payload: ItemRescheduledPayload): Promise<void> {
    const previous = this.deps.eventService.cancelActiveForItem(payload.itemId);
    if (!previous) return;

    this.cancelPendingJobsForEvent(previous.id);

    const recreated = this.deps.eventService.create({
      itemId: payload.itemId,
      title: previous.title,
      startAt: new Date(payload.dueAt),
      deslocamentoMin: previous.deslocamentoMin,
      ...(previous.local !== null ? { local: previous.local } : {}),
      ...(previous.endAt !== null ? { endAt: new Date(previous.endAt) } : {}),
    });

    this.scheduleForEvent(recreated);
  }
}

function belongsToEvent(job: JobRow, eventId: number): boolean {
  const parsed = parseChainJobPayload(job.payload);
  return parsed?.eventId === eventId;
}
