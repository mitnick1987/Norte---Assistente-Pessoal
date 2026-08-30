/** Canal fora do WhatsApp para falha que não pode ser silenciosa (ARCHITECTURE.md §6). */
export interface FailureAlerter {
  alertDeliveryExhausted: (message: { id: number; jid: string; attempts: number }) => Promise<void>;
  /** Refresh de token OAuth falho (ADR-010, FEAT-005): revogação, erro de rede ou credencial inválida — nunca mascarado como sucesso silencioso. */
  alertRefreshFailure: (context: { provider: string; err: unknown }) => Promise<void>;
  /**
   * Ritual-âncora (briefing/revisão, RF-05/RF-06) represado pelo teto diário
   * de proativas (FEAT-006, achado de review) — o teto continua limite duro
   * (RF-24), mas um dia em que ele chega a barrar briefing/revisão quebra a
   * garantia de "nunca deixam de chegar" (PRD §7) e precisa de visibilidade
   * fora do WhatsApp, nunca só um log warn que ninguém olha.
   */
  alertAnchorRitualCapped: (message: { id: number; jid: string }) => Promise<void>;
  /** Sessão WhatsApp caída ou pedido de novo QR (FEAT-008, RF-13) — instrução de re-scan, watchdog de sessão. */
  alertSessionDown: (context: { state: string }) => Promise<void>;
  /** Uso de disco acima do limiar configurado (FEAT-008, RF-13, best-effort). */
  alertDiskUsage: (context: { usagePercent: number; thresholdPercent: number }) => Promise<void>;
  /** Projeção mensal de custo de API acima do orçamento (FEAT-008, RF-15). */
  alertCostBudgetExceeded: (context: { projectedMonthlyCostUsd: number; budgetUsd: number }) => Promise<void>;
  /**
   * Alarme (prioridade mais alta que o de custo, spec item 5) de regressão de
   * prompt caching — `cache_read_input_tokens = 0` em N chamadas seguidas ao
   * Sonnet, sinal de que o cache parou de bater e o custo pode multiplicar
   * 5-10x silenciosamente (ADR-007).
   */
  alertCacheRegression: () => Promise<void>;
}
