import type { IncomingMessage } from '../channel.js';
import type { MessagesUpsertEvent } from './webhook-schema.js';

/**
 * fromMe=true é eco da própria mensagem que o Norte enviou (a Evolution
 * reenvia via webhook) — nunca deve ser tratado como entrada do usuário.
 */
export function isEchoOfOwnMessage(event: MessagesUpsertEvent): boolean {
  return event.data.key.fromMe === true;
}

export function normalizeIncomingMessage(event: MessagesUpsertEvent): IncomingMessage {
  const message = event.data.message;
  const text = message?.conversation ?? message?.extendedTextMessage?.text;

  const kind: IncomingMessage['kind'] = message?.audioMessage
    ? 'audio'
    : message?.imageMessage
      ? 'image'
      : text !== undefined
        ? 'text'
        : 'other';

  return {
    jid: event.data.key.remoteJid,
    waMessageId: event.data.key.id,
    text,
    kind,
  };
}
