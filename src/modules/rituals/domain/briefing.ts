import { selectTopPriorities, type PrioritizableItem } from '../../tasks/public/index.js';
import { buildMicroStep } from './micro-step.js';

/** Nenhum campo de agenda vem da API do Google crua além do necessário para redigir — nunca `snoozeCount`, nunca backlog completo (spec item 5). */
export interface BriefingAgendaEntry {
  readonly title: string;
  readonly startAt: string;
}

export interface BriefingPriority {
  readonly id: number;
  readonly title: string;
}

/**
 * Payload final de dados do briefing: o que entra no prompt de redação do
 * Sonnet e no template de fallback — os dois consomem exatamente a mesma
 * estrutura, então nenhum dos dois pode "ver" mais que o outro (spec item 5:
 * o Sonnet não tem `list_items` irrestrito nesta chamada).
 */
export interface BriefingData {
  readonly agenda: readonly BriefingAgendaEntry[];
  readonly priorities: readonly BriefingPriority[];
  readonly microStep: string | undefined;
}

const MAX_PRIORITIES = 3;

export function buildBriefingData(
  agenda: readonly BriefingAgendaEntry[],
  items: readonly PrioritizableItem[],
): BriefingData {
  const topPriorities = selectTopPriorities(items, MAX_PRIORITIES);
  const first = topPriorities[0];

  return {
    agenda,
    priorities: topPriorities.map((item) => ({ id: item.id, title: item.title })),
    microStep: first ? buildMicroStep(first.title) : undefined,
  };
}

const ACTIONABLE_QUESTION = 'Qual você encara primeiro?';

/**
 * Fallback 100% determinístico (spec item 5, ADR-006): mesmos dados que a
 * redação do Sonnet receberia, sem nenhuma chamada de LLM — o briefing sai
 * de um jeito ou de outro, nunca fica em silêncio por causa de uma falha de
 * API externa.
 */
export function buildBriefingFallbackMessage(data: BriefingData): string {
  const lines: string[] = [];

  if (data.agenda.length > 0) {
    const agendaText = data.agenda.map((entry) => `${formatTime(entry.startAt)} ${entry.title}`).join(', ');
    lines.push(`Hoje na agenda: ${agendaText}.`);
  } else {
    lines.push('Hoje sem compromisso marcado na agenda.');
  }

  if (data.priorities.length > 0) {
    const priorityText = data.priorities.map((p) => p.title).join('; ');
    lines.push(`Prioridades: ${priorityText}.`);
  }

  if (data.microStep) {
    lines.push(data.microStep);
  }

  lines.push(ACTIONABLE_QUESTION);

  return lines.join(' ');
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  const formatter = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  return formatter.format(date);
}

export { ACTIONABLE_QUESTION };
