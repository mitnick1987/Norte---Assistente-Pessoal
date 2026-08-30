import { addZonedDays, toZonedParts, zonedTimeToUtc } from '../../../core/scheduler/domain/index.js';
import type { ChainReminder, ChainSettings, ChainSourceEvent } from './chain-reminder.js';

/**
 * Gerador determinístico de cadeia (RF-04, ADR-006): função pura, sem I/O,
 * sem LLM — dado um evento e as antecedências de settings, devolve a lista
 * de reminders da cadeia já resolvida em America/Sao_Paulo. Quem grava isso
 * em `jobs` é o orquestrador de `chains` (chain-service.ts), nunca esta
 * função.
 *
 * Etapa cujo horário cairia no passado é omitida (Decisões tomadas da
 * FEAT-004): a cadeia nunca agenda um alerta para um instante que já
 * passou — mais simples deixar `expandChain` não produzir a etapa do que
 * ensinar o scheduler (ADR-004) a diferenciar "vencido" de "vencido demais
 * pra valer a pena".
 */
export function expandChain(event: ChainSourceEvent, settings: ChainSettings, now: Date): ChainReminder[] {
  const startParts = toZonedParts(event.startAt);

  const vesperaParts = { ...addZonedDays(startParts, -1), hour: settings.vesperaHour, minute: 0, second: 0 };
  const vesperaAt = zonedTimeToUtc(vesperaParts);

  const manhaParts = { ...startParts, hour: settings.manhaHour, minute: 0, second: 0 };
  const manhaAt = zonedTimeToUtc(manhaParts);

  const prepMarginMs = (event.deslocamentoMin + settings.prepMarginMin) * 60_000;
  const preparoAt = new Date(event.startAt.getTime() - prepMarginMs);

  const candidates: Array<{ tipoCadeia: ChainReminder['tipoCadeia']; fireAt: Date }> = [
    { tipoCadeia: 'vespera', fireAt: vesperaAt },
    { tipoCadeia: 'manha', fireAt: manhaAt },
    { tipoCadeia: 'preparo', fireAt: preparoAt },
  ];

  return candidates
    .filter((candidate) => candidate.fireAt.getTime() > now.getTime())
    .map((candidate) => ({
      tipoCadeia: candidate.tipoCadeia,
      fireAt: candidate.fireAt,
      eventId: event.eventId,
      itemId: event.itemId,
      title: event.title,
      startAt: event.startAt,
      deslocamentoMin: event.deslocamentoMin,
    }));
}
