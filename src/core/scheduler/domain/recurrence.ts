import { addZonedDays, addZonedMonths, toZonedParts, zonedTimeToUtc } from './timezone.js';

/**
 * Recorrências suportadas nesta fundação — o vocabulário cresce junto com
 * os módulos que precisarem (chains, rituals). `daily`/`weekly`/`monthly`
 * bastam para provar o cálculo TZ-aware; RRULE completo fica para quando
 * um RF concreto exigir.
 */
export type RecurrenceRule = 'daily' | 'weekly' | 'monthly';

/**
 * Gera a próxima ocorrência a partir do instante do disparo (fireAt), nunca
 * antecipadamente (ADR-004: "recorrência gera a próxima ocorrência no
 * momento do disparo") — evita deriva se o dono mudar o horário do job
 * entre dois disparos.
 */
export function nextOccurrence(fireAt: Date, rule: RecurrenceRule): Date {
  const parts = toZonedParts(fireAt);

  switch (rule) {
    case 'daily':
      return zonedTimeToUtc(addZonedDays(parts, 1));
    case 'weekly':
      return zonedTimeToUtc(addZonedDays(parts, 7));
    case 'monthly':
      return zonedTimeToUtc(addZonedMonths(parts, 1));
  }
}
