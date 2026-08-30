import { addZonedDays, addZonedMonths, toZonedParts, zonedTimeToUtc } from './timezone.js';

/**
 * Recorrências suportadas nesta fundação — o vocabulário cresce junto com
 * os módulos que precisarem (chains, rituals, nudges). `daily`/`weekly`/
 * `monthly` bastam para os rituais diários/cadências de calendário; `every`
 * (FEAT-007, `modules/nudges`) cobre o caso de um job que precisa reavaliar
 * elegibilidade várias vezes ao dia (cobrança) sem virar cron em memória —
 * RRULE completo fica para quando um RF concreto exigir mais que isso.
 */
export type RecurrenceRule = 'daily' | 'weekly' | 'monthly' | { readonly kind: 'every'; readonly minutes: number };

/**
 * Gera a próxima ocorrência a partir do instante do disparo (fireAt), nunca
 * antecipadamente (ADR-004: "recorrência gera a próxima ocorrência no
 * momento do disparo") — evita deriva se o dono mudar o horário do job
 * entre dois disparos.
 */
export function nextOccurrence(fireAt: Date, rule: RecurrenceRule): Date {
  if (typeof rule === 'object') {
    return new Date(fireAt.getTime() + rule.minutes * 60_000);
  }

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
