/** Canal fora do WhatsApp para falha que não pode ser silenciosa (ARCHITECTURE.md §6). */
export interface FailureAlerter {
  alertDeliveryExhausted: (message: { id: number; jid: string; attempts: number }) => Promise<void>;
}
