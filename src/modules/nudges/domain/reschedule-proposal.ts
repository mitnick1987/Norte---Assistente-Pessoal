import { addZonedDays, startOfZonedDay, toZonedParts, zonedTimeToUtc } from '../../../core/scheduler/domain/index.js';
import { formatWindowLabel, selectMostFrequentWindow, type ResponseSample } from './response-pattern.js';

export interface RescheduleFallbackSettings {
  readonly hour: number;
  readonly minute: number;
}

export interface RescheduleProposal {
  /** Data concreta já resolvida (ISO, UTC) — a mensagem propõe isso, nunca pergunta "para quando?" (spec item 1). */
  readonly proposedAt: string;
  readonly label: string;
  readonly source: 'pattern' | 'fallback';
}

/**
 * Próxima ocorrência do dia da semana + hora informados, em
 * America/Sao_Paulo — sempre estritamente no futuro em relação a `now`.
 * O dia da semana é sempre calculado a partir da meia-noite LOCAL
 * (`startOfZonedDay`), nunca do instante UTC cru de `now`: perto da virada
 * de meia-noite em SP (ex.: 23h de sábado), o instante UTC equivalente já
 * caiu no dia seguinte, e `getUTCDay()` direto devolveria domingo em vez de
 * sábado.
 */
function nextOccurrenceOf(weekday: number, hour: number, now: Date): Date {
  const nowParts = toZonedParts(now);
  const nowWeekday = zonedTimeToUtc(startOfZonedDay(now)).getUTCDay();
  const candidateToday = zonedTimeToUtc({ ...nowParts, hour, minute: 0, second: 0 });

  let diff = (weekday - nowWeekday + 7) % 7;
  if (diff === 0 && candidateToday.getTime() <= now.getTime()) diff = 7;

  const targetDayParts = addZonedDays(nowParts, diff);
  return zonedTimeToUtc({ ...targetDayParts, hour, minute: 0, second: 0 });
}

/**
 * Proposta de reagendamento (spec item 1, RF-08): havendo padrão em
 * `patterns`, propõe o horário mais frequente das últimas respostas
 * ("sábado de manhã, 9h — topa?"); sem padrão, cai no fallback fixo de
 * settings (ex.: "amanhã 9h"). Nunca a pergunta "para quando?" — a data
 * concreta já vem resolvida.
 */
export function buildRescheduleProposal(
  samples: readonly ResponseSample[],
  fallback: RescheduleFallbackSettings,
  now: Date,
): RescheduleProposal {
  const window = selectMostFrequentWindow(samples);

  if (window) {
    const proposedAt = nextOccurrenceOf(window.weekday, window.hour, now);
    return { proposedAt: proposedAt.toISOString(), label: formatWindowLabel(window), source: 'pattern' };
  }

  const tomorrowParts = addZonedDays(toZonedParts(now), 1);
  const proposedAt = zonedTimeToUtc({ ...tomorrowParts, hour: fallback.hour, minute: fallback.minute, second: 0 });
  const label = `amanhã ${String(fallback.hour).padStart(2, '0')}h${fallback.minute > 0 ? String(fallback.minute).padStart(2, '0') : ''}`;
  return { proposedAt: proposedAt.toISOString(), label, source: 'fallback' };
}

/** Mensagem 100% determinística (spec, Decisões tomadas) — nunca "para quando?", sempre a proposta concreta seguida de confirmação simples. */
export function buildRescheduleMessage(proposal: RescheduleProposal): string {
  return `Que tal ${proposal.label} — topa?`;
}
