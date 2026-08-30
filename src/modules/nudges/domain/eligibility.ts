/** Recorte mínimo de item para decidir elegibilidade de cobrança (RF-08) — nunca `snoozeCount` (garantia estrutural, mesmo padrão de `PrioritizableItem`). */
export interface NudgeCandidateItem {
  readonly id: number;
  readonly title: string;
  readonly status: 'ativa' | 'em_andamento' | 'adiada';
  readonly dueAt: string | null;
  /** É uma das top-N prioridades do briefing de hoje e ainda não foi confirmada como feita (spec item 1). */
  readonly isUnconfirmedTopPriority: boolean;
}

export interface NudgeEligibilityContext {
  readonly now: Date;
  /** Cobranças já enviadas hoje (dia civil America/Sao_Paulo) — teto de settings, separado do teto geral do outbox (spec item 1). */
  readonly chargesSentToday: number;
  readonly dailyChargeCap: number;
  /** Modo retorno ativo suprime toda elegibilidade nova (RF-10) — a acumulada não se perde, só fica represada. */
  readonly returnModeSuppressed: boolean;
  /** Itens já cobrados hoje (por id) — nunca cobra o mesmo item duas vezes no mesmo dia. */
  readonly itemIdsChargedToday: ReadonlySet<number>;
}

/**
 * Elegibilidade pura (spec item 1): vencido em status ativo, OU prioridade
 * do dia ainda não confirmada como feita mesmo sem `dueAt` vencido. Os dois
 * limites (supressor de retorno, teto diário) são verificados aqui, não só
 * sugeridos — quem chama nunca decide sozinho se pode disparar.
 */
export function isNudgeEligible(item: NudgeCandidateItem, ctx: NudgeEligibilityContext): boolean {
  if (ctx.returnModeSuppressed) return false;
  if (ctx.chargesSentToday >= ctx.dailyChargeCap) return false;
  if (ctx.itemIdsChargedToday.has(item.id)) return false;

  const isOverdue = item.dueAt !== null && new Date(item.dueAt).getTime() < ctx.now.getTime();
  return isOverdue || item.isUnconfirmedTopPriority;
}

/**
 * Seleciona os itens elegíveis a cobrar agora, respeitando o teto diário
 * como corte definitivo (mesmo se sobrarem mais elegíveis que o teto
 * permite) — quem chama nunca precisa aplicar o corte de novo.
 */
export function selectNudgeEligible(
  items: readonly NudgeCandidateItem[],
  ctx: NudgeEligibilityContext,
): readonly NudgeCandidateItem[] {
  const remainingCap = Math.max(0, ctx.dailyChargeCap - ctx.chargesSentToday);
  if (remainingCap === 0 || ctx.returnModeSuppressed) return [];

  const eligible = items.filter((item) => isNudgeEligible(item, ctx));
  return eligible.slice(0, remainingCap);
}
