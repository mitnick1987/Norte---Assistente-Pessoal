/** Canal fora do WhatsApp para falha que não pode ser silenciosa (ARCHITECTURE.md §6). */
export interface FailureAlerter {
  alertDeliveryExhausted: (message: { id: number; jid: string; attempts: number }) => Promise<void>;
  /** Refresh de token OAuth falho (ADR-010, FEAT-005): revogação, erro de rede ou credencial inválida — nunca mascarado como sucesso silencioso. */
  alertRefreshFailure: (context: { provider: string; err: unknown }) => Promise<void>;
}
