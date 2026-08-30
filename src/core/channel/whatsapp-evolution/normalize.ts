import type { IncomingMessage } from '../channel.js';
import type { MessagesUpsertEvent } from './webhook-schema.js';

/**
 * fromMe=true é eco da própria mensagem que o Norte enviou (a Evolution
 * reenvia via webhook) — nunca deve ser tratado como entrada do usuário.
 */
export function isEchoOfOwnMessage(event: MessagesUpsertEvent): boolean {
  return event.data.key.fromMe === true;
}

/**
 * `fileLength` chega como string no protobuf real (campos `uint64` viram
 * string em JSON para não perder precisão) — normalizamos para number aqui,
 * na borda, para o resto do sistema (checagem de limite) nunca lidar com os
 * dois formatos.
 */
function toNumberOrUndefined(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function normalizeIncomingMessage(event: MessagesUpsertEvent): IncomingMessage {
  const message = event.data.message;
  const text = message?.conversation ?? message?.extendedTextMessage?.text;
  const audioMessage = message?.audioMessage;

  const kind: IncomingMessage['kind'] = audioMessage
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
    audio: audioMessage
      ? {
          mimeType: audioMessage.mimetype ?? 'audio/ogg',
          durationSeconds: audioMessage.seconds,
          fileLengthBytes: toNumberOrUndefined(audioMessage.fileLength),
        }
      : undefined,
    messageKey: event.data.key,
  };
}
