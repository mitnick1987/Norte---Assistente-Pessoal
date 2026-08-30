/**
 * Contrato comum a qualquer canal de mensageria (whatsapp-evolution hoje;
 * api-compat e telegram depois — ARCHITECTURE.md §2). Nenhum fornecedor é
 * ponto de acoplamento estrutural: o resto do sistema fala com `Channel`,
 * nunca com a Evolution diretamente.
 */
export interface IncomingAudio {
  readonly mimeType: string;
  /** Duração em segundos, quando o payload traz (nem todo cliente WhatsApp envia). */
  readonly durationSeconds: number | undefined;
  readonly fileLengthBytes: number | undefined;
}

export interface IncomingMessage {
  readonly jid: string;
  readonly waMessageId: string | undefined;
  readonly text: string | undefined;
  readonly kind: 'text' | 'audio' | 'image' | 'other';
  /** Presente só quando `kind === 'audio'` (FEAT-003). */
  readonly audio: IncomingAudio | undefined;
  /** `key` completa da mensagem — é o que `getBase64FromMediaMessage` precisa para buscar a mídia (nunca o base64 do payload, SECURITY.md §6). */
  readonly messageKey: unknown;
}

export interface Channel {
  readonly name: string;
  sendText: (jid: string, body: string) => Promise<void>;
  sendPresence: (jid: string) => Promise<void>;
}

/**
 * Busca ativa de mídia (FEAT-003) — contrato próprio, separado de `Channel`,
 * porque nem todo canal futuro (api-compat, telegram) necessariamente lida
 * com mídia da mesma forma; módulos que só precisam transcrever áudio
 * dependem só disto, nunca do `EvolutionClient` concreto.
 */
export interface MediaFetcher {
  getBase64FromMediaMessage: (messageKey: unknown) => Promise<string>;
}
