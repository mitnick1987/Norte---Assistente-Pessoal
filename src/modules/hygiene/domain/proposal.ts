import { addZonedMonths, toZonedParts, zonedTimeToUtc } from '../../../core/scheduler/domain/index.js';
import type { HygieneCandidateItem } from './eligibility.js';

/** Nunca `snoozeCount`/`updatedAt` — só o que a mensagem de fato usa (RF-11, mesma garantia estrutural de `PrioritizableItem`). */
export interface HygieneProposal {
  readonly itemId: number;
  readonly title: string;
  /** Data concreta já resolvida (ISO, UTC) para "adiar pro mês que vem" — a mensagem nunca pergunta "para quando?" (spec item 4). */
  readonly nextMonthDueAt: string;
}

export function buildHygieneProposal(item: HygieneCandidateItem, now: Date): HygieneProposal {
  const nextMonth = addZonedMonths(toZonedParts(now), 1);
  return {
    itemId: item.id,
    title: item.title,
    nextMonthDueAt: zonedTimeToUtc(nextMonth).toISOString(),
  };
}

/**
 * Banco de variações estático (RF-14, mesmo padrão de
 * `tasks/domain/tone-templates.ts`): nunca "vamos quebrar essa tarefa"
 * (RF-17/18 fora de escopo), nunca formulada como fracasso — é manutenção de
 * rotina, não cobrança por item parado.
 */
const PROPOSAL_INTRO_VARIATIONS = [
  'Dando uma organizada na lista: o que fazer com',
  'Manutenção de rotina na lista — e',
  'Passando o olho na lista, achei um ponto pra decidir:',
] as const;

function pickIntro(seed: number): string {
  const index = ((seed % PROPOSAL_INTRO_VARIATIONS.length) + PROPOSAL_INTRO_VARIATIONS.length) % PROPOSAL_INTRO_VARIATIONS.length;
  return PROPOSAL_INTRO_VARIATIONS[index]!;
}

function formatMonthDay(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
  }).format(new Date(iso));
}

/**
 * Mensagem 100% determinística (spec, Decisões tomadas): sem chamada ao
 * Sonnet — área mais sensível a tom do produto. Opções sempre arquivar/
 * dropar/adiar, nunca reformuladas como julgamento sobre a pessoa.
 */
export function buildHygieneMessage(proposal: HygieneProposal, seed: number): string {
  const intro = pickIntro(seed);
  const nextMonthDate = formatMonthDay(proposal.nextMonthDueAt);
  return `${intro} "${proposal.title}"? 1) arquivar 2) dropar 3) adiar pra ${nextMonthDate}`;
}
