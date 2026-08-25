/**
 * Contrato comum a qualquer canal de mensageria (whatsapp-evolution hoje;
 * api-compat e telegram depois — ARCHITECTURE.md §2). Nenhum fornecedor é
 * ponto de acoplamento estrutural: o resto do sistema fala com `Channel`,
 * nunca com a Evolution diretamente.
 */
export interface IncomingMessage {
  readonly jid: string;
  readonly waMessageId: string | undefined;
  readonly text: string | undefined;
  readonly kind: 'text' | 'audio' | 'image' | 'other';
}

export interface Channel {
  readonly name: string;
  sendText: (jid: string, body: string) => Promise<void>;
  sendPresence: (jid: string) => Promise<void>;
}
