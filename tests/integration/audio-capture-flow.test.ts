import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from '../../src/app.js';
import { buildTestApp } from '../factories/test-app.js';
import { jsonResponse, stubFetch, type FetchCall } from '../factories/fetch-stub.js';
import { anthropicToolUseResponse, type StubTriageResult } from '../factories/anthropic-stub.js';
import { sttTranscriptionResponse, sttErrorResponse } from '../factories/stt-stub.js';

const OWNER_JID = '5511999999999@s.whatsapp.net';

// terça-feira 2026-08-25 10:00 America/Sao_Paulo (13:00 UTC) — mesma referência de capture-flow.test.ts.
const FIXED_NOW = new Date('2026-08-25T13:00:00.000Z');

function audioWebhookPayload(waMessageId: string, overrides: { mimetype?: string; seconds?: number; fileLength?: string } = {}) {
  return {
    event: 'messages.upsert',
    instance: 'norte-test',
    data: {
      key: { remoteJid: OWNER_JID, id: waMessageId, fromMe: false },
      message: { audioMessage: { mimetype: overrides.mimetype ?? 'audio/ogg', seconds: overrides.seconds, fileLength: overrides.fileLength } },
    },
  };
}

interface RoutedStubConfig {
  readonly triage?: StubTriageResult | { error: number };
  readonly groq?: { text: string } | { error: number };
  readonly openai?: { text: string } | { error: number };
}

/** Roteia por URL: Anthropic, Groq, OpenAI e Evolution passam pelo mesmo fetch global stubado. */
function routedStub(config: RoutedStubConfig) {
  return stubFetch((call: FetchCall) => {
    if (call.url.includes('api.anthropic.com')) {
      const triage = config.triage ?? { classification: 'captura', items: [] };
      if ('error' in triage) return jsonResponse(triage.error, { error: { message: 'erro simulado' } });
      return anthropicToolUseResponse(triage);
    }
    if (call.url.includes('api.groq.com')) {
      const groq = config.groq;
      if (!groq) return sttErrorResponse(500);
      if ('error' in groq) return sttErrorResponse(groq.error);
      return sttTranscriptionResponse(groq.text);
    }
    if (call.url.includes('api.openai.com')) {
      const openai = config.openai;
      if (!openai) return sttErrorResponse(500);
      if ('error' in openai) return sttErrorResponse(openai.error);
      return sttTranscriptionResponse(openai.text);
    }
    // Evolution: sendText/sendPresence/getBase64FromMediaMessage.
    if (call.url.includes('getBase64FromMediaMessage')) return jsonResponse(200, { base64: 'QUFB' });
    return jsonResponse(200, { status: 'success' });
  });
}

describe('fluxo de captura por áudio (FEAT-003, PRD §6 fluxo 1)', () => {
  let app: App;

  beforeEach(() => {
    app = buildTestApp({}, { now: () => FIXED_NOW });
  });

  afterEach(async () => {
    await app.fastify.close();
    app.db.close();
    vi.unstubAllGlobals();
  });

  it('webhook de áudio -> busca mídia -> STT (Groq) -> triagem -> N itens gravados -> confirmação única no outbox', async () => {
    routedStub({
      triage: {
        classification: 'captura',
        items: [
          { type: 'tarefa', title: 'comprar ração' },
          { type: 'compromisso', title: 'dentista', dueExpression: 'sexta 14h' },
        ],
      },
      groq: { text: 'lembra de comprar ração e marcar dentista sexta 14h' },
    });

    const response = await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': 'a'.repeat(32) },
      payload: audioWebhookPayload('wa-audio-1', { seconds: 8, fileLength: '5000' }),
    });

    expect(response.statusCode).toBe(200);
    await app.waitForPendingProcessing();
    await app.outboxProcessor.processPending();

    const items = app.db.prepare('SELECT title FROM items ORDER BY id').all() as { title: string }[];
    expect(items.map((i) => i.title)).toEqual(['comprar ração', 'dentista']);

    const outboxRows = app.db.prepare('SELECT body FROM outbox_messages WHERE jid = ?').all(OWNER_JID) as { body: string }[];
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0]!.body).not.toMatch(/\?/);
    expect(outboxRows[0]!.body.split('\n')).toHaveLength(1);

    const message = app.db.prepare(`SELECT processing_status, transcricao FROM messages WHERE wa_message_id = 'wa-audio-1'`).get() as {
      processing_status: string;
      transcricao: string;
    };
    expect(message.processing_status).toBe('processed');
    expect(message.transcricao).toBe('lembra de comprar ração e marcar dentista sexta 14h');
  });

  it('busca mídia ativamente via getBase64FromMediaMessage, nunca confia em base64 do payload do webhook (SECURITY.md §6)', async () => {
    const { calls } = routedStub({
      triage: { classification: 'captura', items: [{ type: 'nota', title: 'x' }] },
      groq: { text: 'anota uma ideia' },
    });

    // payload "parece" trazer o áudio pronto (campo extra fora do contrato
    // tratado) — mesmo assim a Evolution real precisa ser chamada.
    await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': 'a'.repeat(32) },
      payload: audioWebhookPayload('wa-audio-2'),
    });
    await app.waitForPendingProcessing();

    const mediaCall = calls.find((c) => c.url.includes('getBase64FromMediaMessage'));
    expect(mediaCall).toBeDefined();

    const groqCall = calls.find((c) => c.url.includes('api.groq.com'));
    expect(groqCall).toBeDefined();
  });

  it('falha do primário (Groq) aciona automaticamente o fallback (OpenAI), sem falha total', async () => {
    routedStub({
      triage: { classification: 'captura', items: [{ type: 'nota', title: 'via fallback' }] },
      groq: { error: 500 },
      openai: { text: 'transcrito pelo fallback' },
    });

    await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': 'a'.repeat(32) },
      payload: audioWebhookPayload('wa-audio-3'),
    });
    await app.waitForPendingProcessing();

    const item = app.db.prepare('SELECT title FROM items').get() as { title: string } | undefined;
    expect(item?.title).toBe('via fallback');

    const message = app.db.prepare(`SELECT transcricao FROM messages WHERE wa_message_id = 'wa-audio-3'`).get() as {
      transcricao: string;
    };
    expect(message.transcricao).toBe('transcrito pelo fallback');
  });

  it('falha total de STT (Groq e OpenAI): mensagem marcada failed com log de erro, outbox pede o conteúdo em texto (spec item 3)', async () => {
    routedStub({ groq: { error: 500 }, openai: { error: 500 } });

    const response = await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': 'a'.repeat(32) },
      payload: audioWebhookPayload('wa-audio-4'),
    });
    expect(response.statusCode).toBe(200);
    await app.waitForPendingProcessing();
    await app.outboxProcessor.processPending();

    const message = app.db.prepare(`SELECT processing_status FROM messages WHERE wa_message_id = 'wa-audio-4'`).get() as {
      processing_status: string;
    };
    expect(message.processing_status).toBe('failed');

    const itemCount = app.db.prepare('SELECT COUNT(*) as c FROM items').get() as { c: number };
    expect(itemCount.c).toBe(0);

    const outboxRow = app.db.prepare('SELECT body FROM outbox_messages WHERE jid = ?').get(OWNER_JID) as
      | { body: string }
      | undefined;
    expect(outboxRow?.body).toBeDefined();
    expect(outboxRow!.body.toLowerCase()).toContain('texto');
  });

  it('áudio acima do limite de duração: resposta educada no outbox, nenhuma chamada a provider de STT', async () => {
    const { calls } = routedStub({});

    await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': 'a'.repeat(32) },
      payload: audioWebhookPayload('wa-audio-5', { seconds: 601 }),
    });
    await app.waitForPendingProcessing();
    await app.outboxProcessor.processPending();

    expect(calls.some((c) => c.url.includes('api.groq.com') || c.url.includes('api.openai.com'))).toBe(false);
    expect(calls.some((c) => c.url.includes('getBase64FromMediaMessage'))).toBe(false);

    const outboxRow = app.db.prepare('SELECT body FROM outbox_messages WHERE jid = ?').get(OWNER_JID) as
      | { body: string }
      | undefined;
    expect(outboxRow?.body).toBeDefined();

    const message = app.db.prepare(`SELECT processing_status FROM messages WHERE wa_message_id = 'wa-audio-5'`).get() as {
      processing_status: string;
    };
    expect(message.processing_status).toBe('processed');
  });

  it('recuperação no boot: áudio pending com mídia disponível é reprocessado com sucesso', async () => {
    await app.fastify.close();
    app.db.close();

    const { buildApp } = await import('../../src/app.js');
    const { buildTestEnv } = await import('../factories/test-app.js');
    const env = buildTestEnv({});
    const freshApp = buildApp(env, { outboxSleep: async () => undefined, provisionWebhook: false, now: () => FIXED_NOW });

    freshApp.db
      .prepare(
        `INSERT INTO messages (direction, wa_message_id, jid, body, processing_status, media_type, message_key_json, created_at)
         VALUES ('in', 'wa-audio-recovery-1', ?, NULL, 'pending', 'audio', ?, '2000-01-01 00:00:00')`,
      )
      .run(OWNER_JID, JSON.stringify({ messageKey: { id: 'wa-audio-recovery-1' }, mimeType: 'audio/ogg' }));

    routedStub({
      triage: { classification: 'captura', items: [{ type: 'nota', title: 'recuperado' }] },
      groq: { text: 'ideia recuperada no boot' },
    });

    await freshApp.start();

    const message = freshApp.db
      .prepare(`SELECT processing_status FROM messages WHERE wa_message_id = 'wa-audio-recovery-1'`)
      .get() as { processing_status: string };
    expect(message.processing_status).toBe('processed');

    const item = freshApp.db.prepare('SELECT title FROM items').get() as { title: string } | undefined;
    expect(item?.title).toBe('recuperado');

    await freshApp.stop();
    app = freshApp; // evita duplo close no afterEach — já paramos aqui.
  });

  it('recuperação no boot: áudio pending com mídia expirada responde pedindo texto e marca processed (nunca failed)', async () => {
    await app.fastify.close();
    app.db.close();

    const { buildApp } = await import('../../src/app.js');
    const { buildTestEnv } = await import('../factories/test-app.js');
    const env = buildTestEnv({});
    const freshApp = buildApp(env, { outboxSleep: async () => undefined, provisionWebhook: false, now: () => FIXED_NOW });

    freshApp.db
      .prepare(
        `INSERT INTO messages (direction, wa_message_id, jid, body, processing_status, media_type, message_key_json, created_at)
         VALUES ('in', 'wa-audio-recovery-2', ?, NULL, 'pending', 'audio', ?, '2000-01-01 00:00:00')`,
      )
      .run(OWNER_JID, JSON.stringify({ messageKey: { id: 'wa-audio-recovery-2' }, mimeType: 'audio/ogg' }));

    stubFetch((call: FetchCall) => {
      if (call.url.includes('getBase64FromMediaMessage')) return jsonResponse(404, {});
      return jsonResponse(200, { status: 'success' });
    });

    await freshApp.start();
    await freshApp.outboxProcessor.processPending();

    const message = freshApp.db
      .prepare(`SELECT processing_status FROM messages WHERE wa_message_id = 'wa-audio-recovery-2'`)
      .get() as { processing_status: string };
    expect(message.processing_status).toBe('processed');

    const outboxRow = freshApp.db.prepare('SELECT body FROM outbox_messages WHERE jid = ?').get(OWNER_JID) as
      | { body: string }
      | undefined;
    expect(outboxRow?.body).toBeDefined();
    expect(outboxRow!.body.toLowerCase()).toContain('texto');

    await freshApp.stop();
    app = freshApp;
  });
});
