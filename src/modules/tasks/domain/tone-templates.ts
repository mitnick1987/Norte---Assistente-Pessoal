/**
 * Reconhecimento de conclusão (RF-07, RF-14): banco de variações estático,
 * sem LLM — testável deterministicamente. Nunca menciona contagem de
 * adiamentos, histórico ou tom de fiscal/torcida (TESTING.md §4.1).
 */
const COMPLETION_VARIATIONS = [
  'Feito, anotado.',
  'Show, marquei como feito.',
  'Beleza, dei baixa nisso.',
  'Anotado como feito.',
  'Fechou, registrei.',
] as const;

/** Seleção determinística por índice — nunca `Math.random()` real fora de teste (TESTING.md §7 aplicado por analogia: variação de copy também precisa ser reproduzível em teste). */
export function pickCompletionMessage(seed: number): string {
  const index = ((seed % COMPLETION_VARIATIONS.length) + COMPLETION_VARIATIONS.length) % COMPLETION_VARIATIONS.length;
  return COMPLETION_VARIATIONS[index]!;
}

export const COMPLETION_MESSAGE_VARIATIONS = COMPLETION_VARIATIONS;
