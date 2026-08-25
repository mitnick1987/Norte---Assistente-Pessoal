import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from '../../src/app.js';
import { buildTestApp } from '../factories/test-app.js';
import { jsonResponse, stubFetch } from '../factories/fetch-stub.js';

const WEBHOOK_SECRET = 'a'.repeat(32);
const OWNER_JID = '5511999999999@s.whatsapp.net';

function pingPayload(waMessageId: string) {
  return {
    event: 'messages.upsert',
    instance: 'norte-test',
    data: {
      key: { remoteJid: OWNER_JID, id: waMessageId, fromMe: false },
      message: { conversation: 'ping' },
    },
  };
}

describe('fluxo ping -> pong (kernel + commands + channel + outbox)', () => {
  let app: App;

  beforeEach(() => {
    app = buildTestApp();
  });

  afterEach(async () => {
    await app.fastify.close();
    app.db.close();
    vi.unstubAllGlobals();
  });

  it('responde pong via outbox após receber ping do dono, sem chamar nenhum LLM', async () => {
    const { calls } = stubFetch(() => jsonResponse(200, { status: 'success' }));

    const response = await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': WEBHOOK_SECRET },
      payload: pingPayload('wa-msg-1'),
    });

    expect(response.statusCode).toBe(200);

    // outbox roda em intervalo próprio no processo real — no teste, aciona
    // diretamente para não depender de timer real (TESTING.md §7).
    await app.outboxProcessor.processPending();

    const sendTextCall = calls.find((c) => c.url.includes('/message/sendText/'));
    expect(sendTextCall).toBeDefined();
    const body = JSON.parse(sendTextCall!.init!.body as string) as { number: string; text: string };
    expect(body).toEqual({ number: OWNER_JID, text: 'pong' });

    const delivered = app.db
      .prepare('SELECT status, delivered_at FROM outbox_messages WHERE jid = ?')
      .get(OWNER_JID) as { status: string; delivered_at: string | null };
    expect(delivered.status).toBe('delivered');
    expect(delivered.delivered_at).not.toBeNull();

    const outMessage = app.db
      .prepare(`SELECT body FROM messages WHERE direction = 'out' AND jid = ?`)
      .get(OWNER_JID) as { body: string } | undefined;
    expect(outMessage?.body).toBe('pong');
  });

  it('não responde nada além do webhook 200 quando o texto não é reconhecido por nenhum comando', async () => {
    stubFetch(() => jsonResponse(200));

    const response = await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': WEBHOOK_SECRET },
      payload: {
        event: 'messages.upsert',
        instance: 'norte-test',
        data: {
          key: { remoteJid: OWNER_JID, id: 'wa-msg-2', fromMe: false },
          message: { conversation: 'quero anotar uma ideia solta' },
        },
      },
    });

    expect(response.statusCode).toBe(200);

    const pending = app.db.prepare('SELECT COUNT(*) as c FROM outbox_messages').get() as { c: number };
    expect(pending.c).toBe(0);
  });
});
