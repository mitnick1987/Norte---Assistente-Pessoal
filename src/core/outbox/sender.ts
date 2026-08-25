/**
 * Fronteira entre o outbox e o canal de envio real. O outbox não conhece
 * Evolution — só sabe pedir "manda presença" e "manda texto"; o adapter
 * concreto (whatsapp-evolution hoje, WAHA/Telegram amanhã) implementa isto.
 */
export interface MessageSender {
  sendPresence: (jid: string) => Promise<void>;
  sendText: (jid: string, body: string) => Promise<void>;
}

export class SendFailedError extends Error {
  constructor(cause: unknown) {
    super('falha ao enviar mensagem pelo canal');
    this.name = 'SendFailedError';
    this.cause = cause;
  }
}
