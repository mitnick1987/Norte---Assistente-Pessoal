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
}
