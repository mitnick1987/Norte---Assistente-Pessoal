/**
 * Confirmação de captura em 1 linha (RF-01, RF-14): nunca pergunta nada,
 * nunca menciona estrutura. Um item cita o título; múltiplos itens só
 * confirmam a contagem — listar cada título aqui violaria "1 linha" em
 * capturas de vários itens (ex.: um áudio longo, RF-02, fora de escopo mas
 * o texto multi-item já acontece).
 */
const SINGLE_ITEM_VARIATIONS = ['Anotei: {title}.', 'Beleza, anotado: {title}.', 'Peguei: {title}.'] as const;

const MULTI_ITEM_VARIATIONS = ['Anotei {count} itens.', 'Peguei os {count} itens, todos anotados.'] as const;

/**
 * Quando `dueExpression` veio da triagem mas o parser determinístico não
 * reconheceu (ADR-006): o item ainda é gravado (cai em inbox), só que sem
 * data. A confirmação avisa isso em vez de fingir que agendou um lembrete —
 * honesto, mas nunca uma pergunta pedindo pra especificar a data de novo.
 */
const DATE_UNRESOLVED_SUFFIX_VARIATIONS = [
  ' Não entendi a data, então deixei sem lembrete.',
  ' A data não ficou clara pra mim, guardei sem lembrete.',
] as const;

function pick<T extends readonly string[]>(variations: T, seed: number): T[number] {
  const index = ((seed % variations.length) + variations.length) % variations.length;
  return variations[index]!;
}

export interface CaptureConfirmationItem {
  readonly title: string;
  readonly dueExpressionUnresolved: boolean;
}

export function buildCaptureConfirmation(items: readonly CaptureConfirmationItem[], seed: number): string {
  const anyDateUnresolved = items.some((item) => item.dueExpressionUnresolved);
  const suffix = anyDateUnresolved ? pick(DATE_UNRESOLVED_SUFFIX_VARIATIONS, seed) : '';

  if (items.length === 1) {
    const template = pick(SINGLE_ITEM_VARIATIONS, seed);
    return template.replace('{title}', items[0]!.title) + suffix;
  }
  const template = pick(MULTI_ITEM_VARIATIONS, seed);
  return template.replace('{count}', String(items.length)) + suffix;
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

/**
 * Falha total de STT (spec FEAT-003, item 3): primário e fallback ambos
 * falharam, ou áudio com ruído/sem fala reconhecível. Pede, não culpa —
 * nunca "o áudio falhou" (soaria como defeito do usuário) nem menção a erro
 * técnico (a causa real é irrelevante para quem só quer ser entendido).
 */
const STT_TOTAL_FAILURE_VARIATIONS = [
  'Não consegui ouvir esse áudio agora, me manda em texto?',
  'Esse áudio não chegou claro pra mim — pode mandar em texto?',
  'Não peguei o que você disse nesse áudio, tenta em texto?',
] as const;

export function pickSttFailureMessage(seed: number): string {
  return pick(STT_TOTAL_FAILURE_VARIATIONS, seed);
}

/**
 * Áudio acima do limite de duração/tamanho (spec item 5): educado,
 * informa o limite, sem tom de repreensão — nunca soa como o usuário fez
 * algo errado ao mandar um áudio longo.
 */
const AUDIO_TOO_LONG_VARIATIONS = [
  'Esse áudio passou do limite que eu consigo processar — manda um pedaço menor ou em texto?',
  'Esse áudio é maior do que eu consigo ouvir agora — pode mandar mais curto ou em texto?',
] as const;

export function pickAudioTooLongMessage(seed: number): string {
  return pick(AUDIO_TOO_LONG_VARIATIONS, seed);
}

export {
  SINGLE_ITEM_VARIATIONS,
  MULTI_ITEM_VARIATIONS,
  CONVERSATION_FALLBACK_VARIATIONS,
  STT_TOTAL_FAILURE_VARIATIONS,
  AUDIO_TOO_LONG_VARIATIONS,
};
