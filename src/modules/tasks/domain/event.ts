export type EventStatus = 'ativo' | 'cancelado';

/**
 * `gcal_id` sempre `null` nesta feature (Google Calendar é FEAT-005) — o
 * campo existe no ER geral, a fonte da verdade aqui é só interna.
 */
export interface EventRecord {
  readonly id: number;
  readonly itemId: number;
  readonly gcalId: string | null;
  readonly title: string;
  readonly startAt: string;
  readonly endAt: string | null;
  readonly local: string | null;
  readonly deslocamentoMin: number;
  readonly cadeiaGerada: boolean;
  readonly status: EventStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export class EventNotFoundError extends Error {
  constructor(id: number) {
    super(`evento ${id} não encontrado`);
    this.name = 'EventNotFoundError';
  }
}
