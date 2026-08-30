import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from '../../src/app.js';
import { buildTestApp } from '../factories/test-app.js';
import { jsonResponse, stubFetch, type FetchCall } from '../factories/fetch-stub.js';
import { MAX_ATTEMPTS } from '../../src/core/outbox/domain/backoff.js';

const WEBHOOK_SECRET = 'a'.repeat(32);
const OWNER_JID = '5511999999999@s.whatsapp.net';
const RESEND_API_KEY = 'test-resend-api-key';
const ALERT_EMAIL = 'dono@example.com';

/**
 * Stub único de fetch que roteia por URL — a Evolution (sendText, sendPresence)
 * e o Resend (envio de e-mail) compartilham o `fetch` global dentro do mesmo
 * processo de teste; sem esse roteamento os dois stubs colidiriam.
 */
function stubFetchWithResend() {
  const resendCalls: FetchCall[] = [];
  const { calls } = stubFetch((call) => {
    if (call.url.includes('api.resend.com')) {
      resendCalls.push(call);
      return jsonResponse(200, { id: 'email_stub_id' });
    }
    return jsonResponse(200, { status: 'success' });
  });
  return { calls, resendCalls };
}

describe('FEAT-008 — sessão cai dispara e-mail real (stub)', () => {
  let app: App;

  afterEach(async () => {
    await app.fastify.close();
    app.db.close();
    vi.unstubAllGlobals();
  });

  it('CONNECTION_UPDATE para estado caído aciona o envio de e-mail com instrução de re-scan', async () => {
    const { resendCalls } = stubFetchWithResend();
    app = buildTestApp({ RESEND_API_KEY, ALERT_EMAIL });

    await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': WEBHOOK_SECRET },
      payload: { event: 'connection.update', instance: 'norte-test', data: { state: 'close' } },
    });

    expect(resendCalls).toHaveLength(1);
    const body = JSON.parse(resendCalls[0]!.init!.body as string) as { to: string[]; subject: string; text: string };
    expect(body.to).toEqual([ALERT_EMAIL]);
    expect(body.text).toMatch(/QR/i);
  });

  it('transição para o mesmo estado não dispara e-mail de novo (anti-flood por não-mudança de estado)', async () => {
    const { resendCalls } = stubFetchWithResend();
    app = buildTestApp({ RESEND_API_KEY, ALERT_EMAIL });

    await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': WEBHOOK_SECRET },
      payload: { event: 'connection.update', instance: 'norte-test', data: { state: 'close' } },
    });
    await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': WEBHOOK_SECRET },
      payload: { event: 'connection.update', instance: 'norte-test', data: { state: 'close' } },
    });

    expect(resendCalls).toHaveLength(1);
  });

  it('reconexão (estado open) não dispara alerta', async () => {
    const { resendCalls } = stubFetchWithResend();
    app = buildTestApp({ RESEND_API_KEY, ALERT_EMAIL });

    await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': WEBHOOK_SECRET },
      payload: { event: 'connection.update', instance: 'norte-test', data: { state: 'open' } },
    });

    expect(resendCalls).toHaveLength(0);
  });

  it('QRCODE_UPDATED (pedido de novo QR) aciona o mesmo alerta de re-scan', async () => {
    const { resendCalls } = stubFetchWithResend();
    app = buildTestApp({ RESEND_API_KEY, ALERT_EMAIL });

    const response = await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': WEBHOOK_SECRET },
      payload: { event: 'qrcode.updated', instance: 'norte-test', data: { qrcode: 'base64-irrelevante' } },
    });

    expect(response.statusCode).toBe(200);
    expect(resendCalls).toHaveLength(1);
    const body = JSON.parse(resendCalls[0]!.init!.body as string) as { text: string };
    expect(body.text).toMatch(/QR/i);
  });

  it('payload de qrcode.updated de instância diferente da configurada é ignorado (mesmo isolamento de borda do resto do webhook)', async () => {
    const { resendCalls } = stubFetchWithResend();
    app = buildTestApp({ RESEND_API_KEY, ALERT_EMAIL });

    await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': WEBHOOK_SECRET },
      payload: { event: 'qrcode.updated', instance: 'outra-instancia', data: {} },
    });

    expect(resendCalls).toHaveLength(0);
  });
});

describe('FEAT-008 — retries esgotados disparam e-mail real (stub), não só log', () => {
  let app: App;

  afterEach(async () => {
    await app.fastify.close();
    app.db.close();
    vi.unstubAllGlobals();
  });

  it('esgota retries e o e-mail sai de verdade pelo transporte configurado', async () => {
    const resendCalls: FetchCall[] = [];
    stubFetch((call) => {
      if (call.url.includes('api.resend.com')) {
        resendCalls.push(call);
        return jsonResponse(200, { id: 'email_stub_id' });
      }
      return jsonResponse(500, { error: 'internal' });
    });
    app = buildTestApp({ RESEND_API_KEY, ALERT_EMAIL });

    await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': WEBHOOK_SECRET },
      payload: {
        event: 'messages.upsert',
        instance: 'norte-test',
        data: { key: { remoteJid: OWNER_JID, id: 'wa-alert-1', fromMe: false }, message: { conversation: 'ping' } },
      },
    });
    await app.waitForPendingProcessing();

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      app.db.prepare(`UPDATE outbox_messages SET retry_after = NULL WHERE jid = ?`).run(OWNER_JID);
      await app.outboxProcessor.processPending();
    }

    expect(resendCalls).toHaveLength(1);
    const body = JSON.parse(resendCalls[0]!.init!.body as string) as { to: string[] };
    expect(body.to).toEqual([ALERT_EMAIL]);
  });
});
