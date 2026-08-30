import Fastify from 'fastify';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../../src/core/db/migrator.js';
import { coreMigrations } from '../../src/core/db/migrations/index.js';
import { MessageRepository } from '../../src/core/channel/message-repository.js';
import { OutboxRepository } from '../../src/core/outbox/index.js';
import { ConnectionWatchdog, registerEvolutionWebhookRoute } from '../../src/core/channel/whatsapp-evolution/index.js';
import type { AudioMessageHandler } from '../../src/core/channel/whatsapp-evolution/index.js';
import { createLogger } from '../../src/core/logger.js';
import type { CommandMatcher } from '../../src/core/kernel/types.js';

const WEBHOOK_SECRET = 'a'.repeat(32);
const OWNER_JID = '5511999999999@s.whatsapp.net';
const INSTANCE = 'norte-test';

function textPayload(waMessageId: string, text: string) {
  return {
    event: 'messages.upsert',
    instance: INSTANCE,
    data: {
      key: { remoteJid: OWNER_JID, id: waMessageId, fromMe: false },
      message: { conversation: text },
    },
  };
}

function audioPayload(waMessageId: string) {
  return {
    event: 'messages.upsert',
    instance: INSTANCE,
    data: {
      key: { remoteJid: OWNER_JID, id: waMessageId, fromMe: false },
      message: { audioMessage: { mimetype: 'audio/ogg' } },
    },
  };
}

function buildFastify(
  onUnmatchedText: (text: string, jid: string, messageId: number) => Promise<void>,
  onAudioMessage?: AudioMessageHandler,
  onInboundRecorded?: (jid: string, messageId: number) => void,
) {
  const db = new Database(':memory:');
  runMigrations(db, coreMigrations);

  const messageRepository = new MessageRepository(db);
  const outboxRepository = new OutboxRepository(db);
  const logger = createLogger('test');
  const errorSpy = vi.spyOn(logger, 'error');

  const fastify = Fastify();
  registerEvolutionWebhookRoute(fastify, {
    webhookSecret: WEBHOOK_SECRET,
    instance: INSTANCE,
    ownerJid: OWNER_JID,
    messageRepository,
    outboxRepository,
    commands: [] as CommandMatcher[],
    connectionWatchdog: new ConnectionWatchdog(),
    logger,
    onUnmatchedText,
    ...(onAudioMessage ? { onAudioMessage } : {}),
    ...(onInboundRecorded ? { onInboundRecorded } : {}),
  });

  return { fastify, db, messageRepository, errorSpy };
}

describe('registro do webhook: ACK imediato + processamento em background (ADR-018)', () => {
  let fastify: ReturnType<typeof buildFastify>['fastify'] | undefined;
  let db: Database.Database | undefined;

  afterEach(async () => {
    if (fastify) await fastify.close();
    if (db) db.close();
    vi.restoreAllMocks();
  });

  it('responde 2xx antes do processamento em background terminar', async () => {
    let resolveProcessing: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      resolveProcessing = resolve;
    });
    let processingStarted = false;

    const ctx = buildFastify(async () => {
      processingStarted = true;
      await gate;
    });
    fastify = ctx.fastify;
    db = ctx.db;

    const response = await ctx.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': WEBHOOK_SECRET },
      payload: textPayload('wa-1', 'texto qualquer'),
    });

    expect(response.statusCode).toBe(200);
    expect(processingStarted).toBe(true);

    // mensagem ainda pending — o processamento não teve chance de terminar,
    // já que a promise interna nunca foi resolvida.
    const row = ctx.db.prepare(`SELECT processing_status FROM messages WHERE wa_message_id = 'wa-1'`).get() as {
      processing_status: string;
    };
    expect(row.processing_status).toBe('pending');

    resolveProcessing!();
  });

  it('marca a mensagem como failed e loga o erro quando o processamento lança exceção não tratada', async () => {
    const ctx = buildFastify(async () => {
      throw new Error('falha definitiva simulada');
    });
    fastify = ctx.fastify;
    db = ctx.db;

    const response = await ctx.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': WEBHOOK_SECRET },
      payload: textPayload('wa-1', 'texto qualquer'),
    });

    expect(response.statusCode).toBe(200);

    // dá espaço pro microtask do `.catch` da promise não aguardada rodar.
    await new Promise((resolve) => setTimeout(resolve, 20));

    const row = ctx.db.prepare(`SELECT processing_status FROM messages WHERE wa_message_id = 'wa-1'`).get() as {
      processing_status: string;
    };
    expect(row.processing_status).toBe('failed');

    expect(ctx.errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ waMessageId: 'wa-1' }),
      expect.stringContaining('falha ao processar'),
    );
  });

  it('mensagem de áudio sem onAudioMessage configurado (rota sem FEAT-003) é marcada processed sem acionar o processamento', async () => {
    const onUnmatchedText = vi.fn(async () => undefined);
    const ctx = buildFastify(onUnmatchedText);
    fastify = ctx.fastify;
    db = ctx.db;

    const payload = {
      event: 'messages.upsert',
      instance: INSTANCE,
      data: {
        key: { remoteJid: OWNER_JID, id: 'wa-audio-1', fromMe: false },
        message: { audioMessage: { url: 'x' } },
      },
    };

    const response = await ctx.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': WEBHOOK_SECRET },
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(onUnmatchedText).not.toHaveBeenCalled();

    const row = ctx.db.prepare(`SELECT processing_status FROM messages WHERE wa_message_id = 'wa-audio-1'`).get() as {
      processing_status: string;
    };
    expect(row.processing_status).toBe('processed');
  });

  it('FEAT-003: com onAudioMessage configurado, responde 2xx antes do processamento de áudio terminar', async () => {
    let resolveProcessing: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      resolveProcessing = resolve;
    });
    let processingStarted = false;

    const onAudioMessage: AudioMessageHandler = async () => {
      processingStarted = true;
      await gate;
    };
    const ctx = buildFastify(async () => undefined, onAudioMessage);
    fastify = ctx.fastify;
    db = ctx.db;

    const response = await ctx.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': WEBHOOK_SECRET },
      payload: audioPayload('wa-audio-2'),
    });

    expect(response.statusCode).toBe(200);
    expect(processingStarted).toBe(true);

    const row = ctx.db.prepare(`SELECT processing_status FROM messages WHERE wa_message_id = 'wa-audio-2'`).get() as {
      processing_status: string;
    };
    expect(row.processing_status).toBe('pending');

    resolveProcessing!();
  });

  it('FEAT-003: onAudioMessage lançando exceção marca a mensagem como failed e loga o erro', async () => {
    const onAudioMessage: AudioMessageHandler = async () => {
      throw new Error('falha simulada no processamento de áudio');
    };
    const ctx = buildFastify(async () => undefined, onAudioMessage);
    fastify = ctx.fastify;
    db = ctx.db;

    const response = await ctx.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': WEBHOOK_SECRET },
      payload: audioPayload('wa-audio-3'),
    });

    expect(response.statusCode).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const row = ctx.db.prepare(`SELECT processing_status FROM messages WHERE wa_message_id = 'wa-audio-3'`).get() as {
      processing_status: string;
    };
    expect(row.processing_status).toBe('failed');
    expect(ctx.errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ waMessageId: 'wa-audio-3' }),
      expect.stringContaining('falha ao processar áudio'),
    );
  });

  /**
   * Achado de review (RF-10, modo retorno): `onInboundRecorded` é
   * síncrono e best-effort de propósito (nunca deveria derrubar o
   * processamento principal), mas uma falha transitória aqui não podia
   * passar batido sem log — o resumo de reentrada é one-shot, e sem log
   * a perda seria completamente silenciosa.
   */
  it('onInboundRecorded lançando exceção é logado como erro e não impede o processamento principal (best-effort)', async () => {
    const onUnmatchedText = vi.fn(async () => undefined);
    const onInboundRecorded = vi.fn(() => {
      throw new Error('falha transitória no cálculo de reentrada');
    });
    const ctx = buildFastify(onUnmatchedText, undefined, onInboundRecorded);
    fastify = ctx.fastify;
    db = ctx.db;

    const response = await ctx.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': WEBHOOK_SECRET },
      payload: textPayload('wa-1', 'texto qualquer'),
    });

    expect(response.statusCode).toBe(200);
    expect(onInboundRecorded).toHaveBeenCalledTimes(1);

    // erro logado, com o messageId pra rastreio.
    expect(ctx.errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: expect.any(Number) }),
      expect.stringContaining('modo retorno'),
    );

    // processamento principal segue normalmente apesar da falha no hook.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onUnmatchedText).toHaveBeenCalledTimes(1);
    const row = ctx.db.prepare(`SELECT processing_status FROM messages WHERE wa_message_id = 'wa-1'`).get() as {
      processing_status: string;
    };
    expect(row.processing_status).toBe('processed');
  });

  it('onInboundRecorded bem-sucedido não gera log de erro', async () => {
    const onUnmatchedText = vi.fn(async () => undefined);
    const onInboundRecorded = vi.fn(() => undefined);
    const ctx = buildFastify(onUnmatchedText, undefined, onInboundRecorded);
    fastify = ctx.fastify;
    db = ctx.db;

    await ctx.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': WEBHOOK_SECRET },
      payload: textPayload('wa-1', 'texto qualquer'),
    });

    expect(onInboundRecorded).toHaveBeenCalledTimes(1);
    expect(ctx.errorSpy).not.toHaveBeenCalled();
  });
});
