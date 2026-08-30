/**
 * Guarda contra a tool `create_event` receber uma data fora de qualquer
 * intervalo sensato (spec FEAT-006, item 2 e Impacto técnico — áreas
 * sensíveis): o brain resolve `startAt` a partir da data/hora injetada no
 * prompt (item 3), mas o backend nunca confia cegamente nisso. Passado
 * distante e horizonte absurdamente longe no futuro são os dois sintomas de
 * o modelo ter alucinado ano/dia em vez de usar a data injetada.
 */
const PAST_TOLERANCE_MS = 5 * 60_000;
const MAX_FUTURE_YEARS = 5;

export type EventDateValidation =
  | { readonly valid: true }
  | { readonly valid: false; readonly reason: 'in_past' | 'too_far_in_future' | 'end_before_start' };

export function validateEventDates(startAt: Date, endAt: Date, now: Date): EventDateValidation {
  if (startAt.getTime() < now.getTime() - PAST_TOLERANCE_MS) {
    return { valid: false, reason: 'in_past' };
  }

  const maxFuture = new Date(now);
  maxFuture.setFullYear(maxFuture.getFullYear() + MAX_FUTURE_YEARS);
  if (startAt.getTime() > maxFuture.getTime()) {
    return { valid: false, reason: 'too_far_in_future' };
  }

  if (endAt.getTime() <= startAt.getTime()) {
    return { valid: false, reason: 'end_before_start' };
  }

  return { valid: true };
}
