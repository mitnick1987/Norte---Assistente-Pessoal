/**
 * Micropasso do briefing (RF-17 parcial, spec item 5, Decisões tomadas):
 * heurística de código, não geração por LLM — a versão reativa e negociada
 * de verdade é RF-17/M2. Aqui só o suficiente para "o briefing já traz o
 * primeiro passo da prioridade 1 desde o M1": se o título já começa com um
 * verbo de ação reconhecível, o passo é literalmente "começar" por ele;
 * senão cai num genérico que nunca soa como comando vazio.
 */
const ACTION_VERBS_PT = [
  'ligar',
  'enviar',
  'mandar',
  'escrever',
  'responder',
  'revisar',
  'pagar',
  'agendar',
  'marcar',
  'comprar',
  'buscar',
  'levar',
  'preparar',
  'organizar',
  'finalizar',
  'terminar',
  'comecar',
  'iniciar',
  'ler',
  'estudar',
  'chamar',
  'avisar',
  'confirmar',
  'resolver',
  'arrumar',
  'limpar',
] as const;

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/** Genérico de propósito: aplicável a qualquer título, nunca soa como pergunta nem como comando vazio ("faça algo"). */
const GENERIC_FIRST_STEP = 'Abrir isso e dar o primeiro passo, mesmo que pequeno.';

export function buildMicroStep(title: string): string {
  const normalized = normalize(title);
  const firstWord = normalized.split(/\s+/)[0] ?? '';

  const matchedVerb = ACTION_VERBS_PT.find((verb) => firstWord.startsWith(verb));
  if (!matchedVerb) return GENERIC_FIRST_STEP;

  return `Começar por: ${title}.`;
}
