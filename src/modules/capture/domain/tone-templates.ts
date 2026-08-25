import type { TriageItem } from './triage-schema.js';

/**
 * Confirmação de captura em 1 linha (RF-01, RF-14): nunca pergunta nada,
 * nunca menciona estrutura. Um item cita o título; múltiplos itens só
 * confirmam a contagem — listar cada título aqui violaria "1 linha" em
 * capturas de vários itens (ex.: um áudio longo, RF-02, fora de escopo mas
 * o texto multi-item já acontece).
 */
const SINGLE_ITEM_VARIATIONS = ['Anotei: {title}.', 'Beleza, anotado: {title}.', 'Peguei: {title}.'] as const;

const MULTI_ITEM_VARIATIONS = ['Anotei {count} itens.', 'Peguei os {count} itens, todos anotados.'] as const;

function pick<T extends readonly string[]>(variations: T, seed: number): T[number] {
  const index = ((seed % variations.length) + variations.length) % variations.length;
  return variations[index]!;
}

export function buildCaptureConfirmation(items: readonly TriageItem[], seed: number): string {
  if (items.length === 1) {
    const template = pick(SINGLE_ITEM_VARIATIONS, seed);
    return template.replace('{title}', items[0]!.title);
  }
  const template = pick(MULTI_ITEM_VARIATIONS, seed);
  return template.replace('{count}', String(items.length));
}

/**
 * Resposta padrão de conversa (RF-14, item 5 da spec): honesta sobre o que
 * o sistema ainda não faz, nunca um "não entendi" evasivo. O Sonnet
 * (conversa livre) é feature futura — aqui não há chamada nenhuma a ele.
 */
const CONVERSATION_FALLBACK_VARIATIONS = [
  'Ainda não converso sobre isso — só capturo, marco como feito, adio ou dropo itens.',
  'Isso eu ainda não faço: por enquanto só anoto, concluo, adio ou dropo.',
] as const;

export function pickConversationFallback(seed: number): string {
  return pick(CONVERSATION_FALLBACK_VARIATIONS, seed);
}

export { SINGLE_ITEM_VARIATIONS, MULTI_ITEM_VARIATIONS, CONVERSATION_FALLBACK_VARIATIONS };
