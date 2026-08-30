import type { PrioritizableItem } from './priority-selection.js';

export interface ReviewCompletedEntry {
  readonly title: string;
}

export interface ReviewRescheduledEntry {
  readonly title: string;
}

export interface ReviewDecisionCandidate {
  readonly id: number;
  readonly title: string;
}

/** Mesma regra do briefing: nunca `snoozeCount`, nunca mais que o necessário para redigir (spec item 6/7). */
export interface ReviewData {
  readonly completedToday: readonly ReviewCompletedEntry[];
  readonly rescheduledToTomorrow: readonly ReviewRescheduledEntry[];
  readonly decisionRequested: ReviewDecisionCandidate | undefined;
}

/**
 * Item mais antigo elegível a decisão (spec item 6: "critério determinístico
 * simples") — o candidato mais parado é o que mais precisa de uma decisão
 * explícita do dono; nunca mais de um item por revisão (teto imposto aqui,
 * na montagem dos dados, não só no texto).
 */
export function selectReviewDecisionCandidate(
  eligibleItems: readonly PrioritizableItem[],
): ReviewDecisionCandidate | undefined {
  if (eligibleItems.length === 0) return undefined;

  const oldest = [...eligibleItems].sort((a, b) => a.id - b.id)[0]!;
  return { id: oldest.id, title: oldest.title };
}

export function buildReviewData(
  completedToday: readonly ReviewCompletedEntry[],
  rescheduledToTomorrow: readonly ReviewRescheduledEntry[],
  eligibleForDecision: readonly PrioritizableItem[],
): ReviewData {
  return {
    completedToday,
    rescheduledToTomorrow,
    decisionRequested: selectReviewDecisionCandidate(eligibleForDecision),
  };
}

/** Teto de mensagens da revisão (spec item 6): imposto aqui, não só sugerido no prompt — quem monta o envio nunca recebe mais que isso para enfileirar. */
export const REVIEW_MAX_MESSAGES = 3;

/**
 * Fallback 100% determinístico, mesmo padrão do briefing (ADR-006): sempre
 * no máximo `REVIEW_MAX_MESSAGES` mensagens, cada uma respondível por
 * número quando fizer sentido (a pergunta de decisão é a única que precisa).
 */
export function buildReviewFallbackMessages(data: ReviewData): string[] {
  const messages: string[] = [];

  if (data.completedToday.length > 0) {
    const titles = data.completedToday.map((e) => e.title).join(', ');
    messages.push(`Hoje você fechou: ${titles}.`);
  } else {
    messages.push('Sem itens fechados hoje — sem problema, amanhã é outro dia.');
  }

  if (data.rescheduledToTomorrow.length > 0) {
    const titles = data.rescheduledToTomorrow.map((e) => e.title).join(', ');
    messages.push(`Fica para amanhã: ${titles}.`);
  }

  if (data.decisionRequested) {
    messages.push(`Sobre "${data.decisionRequested.title}": o que você quer fazer? 1) manter 2) adiar 3) dropar`);
  }

  return messages.slice(0, REVIEW_MAX_MESSAGES);
}
