/** Nunca `snoozeCount`/histórico — só o título, mesma garantia estrutural de `PrioritizableItem` (RF-08, spec item 1). */
export interface ChargeableItem {
  readonly id: number;
  readonly title: string;
}

/**
 * Banco de variações estático (RF-14, mesmo padrão de
 * `tasks/domain/tone-templates.ts`): tom neutro, nunca menciona quantas
 * vezes o item já foi adiado ou vencido — sempre oferece "dropar" no menu
 * (proibição testada, TESTING.md §4.1).
 */
const CHARGE_INTRO_VARIATIONS = [
  (title: string) => `Sobre "${title}":`,
  (title: string) => `"${title}" ainda está na sua lista.`,
  (title: string) => `Passando pra ver "${title}".`,
] as const;

function pickIntro(seed: number, title: string): string {
  const index = ((seed % CHARGE_INTRO_VARIATIONS.length) + CHARGE_INTRO_VARIATIONS.length) % CHARGE_INTRO_VARIATIONS.length;
  return CHARGE_INTRO_VARIATIONS[index]!(title);
}

const MENU_SUFFIX = '1) feito 2) reagendar 3) dropar';

/** Mensagem de cobrança (RF-08): sempre o menu completo, seleção de variação determinística por `seed` (id do item) para ser reproduzível em teste. */
export function buildChargeMessage(item: ChargeableItem): string {
  return `${pickIntro(item.id, item.title)} ${MENU_SUFFIX}`;
}
