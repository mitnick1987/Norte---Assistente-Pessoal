import { describe, expect, it } from 'vitest';
import { isEchoOfOwnMessage, normalizeIncomingMessage } from '../../src/core/channel/whatsapp-evolution/normalize.js';
import type { MessagesUpsertEvent } from '../../src/core/channel/whatsapp-evolution/webhook-schema.js';

function buildEvent(overrides: Partial<MessagesUpsertEvent['data']>): MessagesUpsertEvent {
  return {
    event: 'messages.upsert',
    instance: 'norte',
    data: {
      key: { remoteJid: '5511999999999@s.whatsapp.net', id: 'msg-1', fromMe: false },
      ...overrides,
    },
  };
}

describe('normalizeIncomingMessage', () => {
  it('extrai texto de mensagem de conversa simples', () => {
    const event = buildEvent({ message: { conversation: 'ping' } });
    expect(normalizeIncomingMessage(event)).toMatchObject({ text: 'ping', kind: 'text' });
  });

  it('extrai texto de extendedTextMessage', () => {
    const event = buildEvent({ message: { extendedTextMessage: { text: 'oi' } } });
    expect(normalizeIncomingMessage(event)).toMatchObject({ text: 'oi', kind: 'text' });
  });

  it('classifica mensagem de áudio mesmo sem texto', () => {
    const event = buildEvent({ message: { audioMessage: {} } });
    expect(normalizeIncomingMessage(event)).toMatchObject({ kind: 'audio', text: undefined });
  });

  it('classifica mensagem de imagem mesmo sem texto', () => {
    const event = buildEvent({ message: { imageMessage: {} } });
    expect(normalizeIncomingMessage(event)).toMatchObject({ kind: 'image' });
  });

  it('classifica como "other" quando não há conteúdo reconhecido', () => {
    const event = buildEvent({});
    expect(normalizeIncomingMessage(event)).toMatchObject({ kind: 'other', text: undefined });
  });
});

describe('isEchoOfOwnMessage', () => {
  it('identifica mensagem com fromMe=true como eco do próprio envio', () => {
    const event = buildEvent({ key: { remoteJid: 'x', fromMe: true } });
    expect(isEchoOfOwnMessage(event)).toBe(true);
  });

  it('não marca como eco quando fromMe é false ou ausente', () => {
    expect(isEchoOfOwnMessage(buildEvent({ key: { remoteJid: 'x', fromMe: false } }))).toBe(false);
    expect(isEchoOfOwnMessage(buildEvent({ key: { remoteJid: 'x' } }))).toBe(false);
  });
});
