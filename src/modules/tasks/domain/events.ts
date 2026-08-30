/**
 * Vocabulário de eventos que `tasks` publica no bus (ADR-011: módulo só
 * pode ser chamado diretamente por quem depende dele — a via de volta,
 * "tasks avisa quem quiser reagir", é sempre por evento). `chains` assina
 * estes dois para cancelar/regenerar a cadeia de um compromisso sem que
 * `tasks` precise conhecer `chains` (FEAT-004, Decisões tomadas).
 */
export const ITEM_DROPPED_EVENT = 'item.dropped';
export const ITEM_RESCHEDULED_EVENT = 'item.rescheduled';

export interface ItemDroppedPayload {
  readonly itemId: number;
}

/** `dueAt` já resolvido (ISO, UTC) — quem assina nunca recalcula a data, só reage a ela. */
export interface ItemRescheduledPayload {
  readonly itemId: number;
  readonly dueAt: string;
}

export interface TasksEventMap {
  readonly [ITEM_DROPPED_EVENT]: ItemDroppedPayload;
  readonly [ITEM_RESCHEDULED_EVENT]: ItemRescheduledPayload;
}

/** Assinatura mínima que `ItemService` precisa para publicar — o bus real (core/bus) satisfaz isso estruturalmente. */
export type TasksEventEmitter = <K extends keyof TasksEventMap>(
  event: K,
  payload: TasksEventMap[K],
) => void | Promise<void>;
