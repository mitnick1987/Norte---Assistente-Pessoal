/**
 * Templates determinísticos da cadeia (RF-04, ADR-006): caminho crítico
 * 100% sem LLM, mesmo banco estático de variação da FEAT-002
 * (capture/domain/tone-templates.ts) — tom RSD-safe testado, nunca nuance
 * de copy (CODE_STYLE §2).
 */

const VESPERA_VARIATIONS = ['Amanhã você tem: {title}.', 'Pra amanhã: {title}.', 'Olha o que te espera amanhã: {title}.'] as const;

const MANHA_VARIATIONS = ['Hoje mais tarde: {title}.', 'Lembrando: hoje tem {title}.', 'Hoje no seu dia: {title}.'] as const;

function pick<T extends readonly string[]>(variations: T, seed: number): T[number] {
  const index = ((seed % variations.length) + variations.length) % variations.length;
  return variations[index]!;
}

export function buildVesperaMessage(title: string, seed: number): string {
  return pick(VESPERA_VARIATIONS, seed).replace('{title}', title);
}

export function buildManhaMessage(title: string, seed: number): string {
  return pick(MANHA_VARIATIONS, seed).replace('{title}', title);
}

/**
 * Alerta de "hora de sair" (RF-04, requisito central): sempre tempo
 * restante formatado, nunca só o horário absoluto — é o que resolve a
 * cegueira temporal que motivou a feature. `minutesRemaining` já vem
 * arredondado de quem chama (chain-service.ts calcula a partir de `now` no
 * momento do disparo, não no momento em que o job foi criado).
 */
const PREPARO_VARIATIONS = [
  'Faltam {minutes} min pra sair: {title}.',
  'Hora de se organizar pra sair — faltam {minutes} min: {title}.',
  '{title} em breve. Faltam {minutes} min pra sair.',
] as const;

export function buildPreparoMessage(title: string, minutesRemaining: number, seed: number): string {
  const clamped = Math.max(0, Math.round(minutesRemaining));
  return pick(PREPARO_VARIATIONS, seed).replace('{title}', title).replace('{minutes}', String(clamped));
}

export { VESPERA_VARIATIONS, MANHA_VARIATIONS, PREPARO_VARIATIONS };
