import { TONE_RULES_BLOCK } from './tone-rules.js';

/**
 * Módulo com fragmento de prompt, na forma mínima que este montador precisa
 * conhecer (KernelRegistry já ordena por nome — ARCHITECTURE.md §2 — este
 * tipo só existe para não acoplar `core/llm` ao `ModuleManifest` inteiro).
 */
export interface PromptFragmentSource {
  readonly name: string;
  readonly promptFragment?: () => string;
}

/**
 * Monta o system prompt do brain byte a byte determinístico (ADR-007): a
 * ordem dos fragmentos é por nome de módulo (mesma ordem que o kernel já usa
 * para tools/commands/migrations — nunca ordem de registro em runtime), e o
 * bloco de regras de tom vem sempre por último, fixo. Nenhuma data/hora
 * entra aqui — isso é responsabilidade exclusiva da última mensagem do
 * usuário (spec item 3), porque cache_control marca este texto inteiro como
 * prefixo cacheável e qualquer byte que mude por chamada invalida o cache.
 */
export function buildBrainSystemPrompt(modules: readonly PromptFragmentSource[]): string {
  const sorted = [...modules].sort((a, b) => a.name.localeCompare(b.name));
  const fragments = sorted
    .map((m) => m.promptFragment?.())
    .filter((fragment): fragment is string => Boolean(fragment));

  return [...fragments, TONE_RULES_BLOCK].join('\n\n');
}

const WEEKDAY_NAMES_PT = [
  'domingo',
  'segunda-feira',
  'terça-feira',
  'quarta-feira',
  'quinta-feira',
  'sexta-feira',
  'sábado',
] as const;

/**
 * Formata a data/hora corrente (America/Sao_Paulo) para injeção na última
 * mensagem do usuário — nunca no system prompt (spec item 3). Duplica o
 * formato de `capture/domain/triage-prompt.ts` de propósito: são dois
 * consumidores (Haiku triagem, Sonnet brain) com propósitos distintos o
 * bastante para não valer a pena forçar um import cruzado entre módulo e
 * core só para uma função de formatação de 4 linhas.
 */
export function formatCurrentDateTimeForPrompt(zonedParts: {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}): string {
  const referenceUtc = new Date(Date.UTC(zonedParts.year, zonedParts.month - 1, zonedParts.day));
  const weekday = WEEKDAY_NAMES_PT[referenceUtc.getUTCDay()];
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${weekday}, ${pad(zonedParts.day)}/${pad(zonedParts.month)}/${zonedParts.year} ${pad(zonedParts.hour)}:${pad(zonedParts.minute)}`;
}
