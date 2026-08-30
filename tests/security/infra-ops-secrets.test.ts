import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from '../../src/app.js';
import { buildTestApp } from '../factories/test-app.js';
import { jsonResponse, stubFetch } from '../factories/fetch-stub.js';
import { MAX_ATTEMPTS } from '../../src/core/outbox/domain/backoff.js';

const WEBHOOK_SECRET = 'a'.repeat(32);
const OWNER_JID = '5511999999999@s.whatsapp.net';
const RESEND_API_KEY = 'chave-resend-nao-pode-vazar';
const ALERT_EMAIL = 'dono-nao-pode-vazar@example.com';

function captureStdout(): { logs: string[]; restore: () => void } {
  const logs: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- captura raw de stdout só para asserção de log neste teste
  (process.stdout.write as any) = (chunk: string) => {
    logs.push(String(chunk));
    return true;
  };
  return {
    logs,
    restore: () => {
      process.stdout.write = originalWrite;
    },
  };
}

/**
 * S9 (extensão FEAT-008): RESEND_API_KEY nunca aparece em log, mesmo em
 * debug ou em falha de envio — e nunca viaja fora do header Authorization
 * esperado pela API do Resend (SECURITY.md §4).
 */
describe('S9 (extensão FEAT-008): RESEND_API_KEY e ALERT_EMAIL nunca aparecem em log', () => {
  let app: App;

  afterEach(async () => {
    await app.fastify.close();
    app.db.close();
    vi.unstubAllGlobals();
  });

  it('nunca envia a RESEND_API_KEY em texto plano fora do header Authorization', async () => {
    const { calls } = stubFetch((call) => {
      if (call.url.includes('api.resend.com')) return jsonResponse(200, { id: 'stub' });
      return jsonResponse(200, { status: 'success' });
    });
    app = buildTestApp({ RESEND_API_KEY, ALERT_EMAIL });

    await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': WEBHOOK_SECRET },
      payload: { event: 'connection.update', instance: 'norte-test', data: { state: 'close' } },
    });

    const resendCall = calls.find((c) => c.url.includes('api.resend.com'));
    expect(resendCall).toBeDefined();
    const headers = resendCall!.init!.headers as Record<string, string>;
    expect(headers['Authorization']).toBe(`Bearer ${RESEND_API_KEY}`);
    expect(resendCall!.init!.body as string).not.toContain(RESEND_API_KEY);
  });

  it('não expõe RESEND_API_KEY no log quando o envio de e-mail falha', async () => {
    stubFetch((call) => {
      if (call.url.includes('api.resend.com')) return jsonResponse(401, { message: `invalid key ${RESEND_API_KEY}` });
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
        data: { key: { remoteJid: OWNER_JID, id: 'wa-sec-1', fromMe: false }, message: { conversation: 'ping' } },
      },
    });
    await app.waitForPendingProcessing();

    const { logs, restore } = captureStdout();
    try {
      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        app.db.prepare(`UPDATE outbox_messages SET retry_after = NULL WHERE jid = ?`).run(OWNER_JID);
        await app.outboxProcessor.processPending();
      }
    } finally {
      restore();
    }

    expect(logs.join('')).not.toContain(RESEND_API_KEY);
  });

  it('não expõe ALERT_EMAIL (PII do dono) no log de erro quando não há transporte configurado', async () => {
    app = buildTestApp({ RESEND_API_KEY: undefined, SMTP_URL: undefined, ALERT_EMAIL });

    const { logs, restore } = captureStdout();
    try {
      await app.fastify.inject({
        method: 'POST',
        url: '/webhook/evolution',
        headers: { 'x-webhook-secret': WEBHOOK_SECRET },
        payload: { event: 'connection.update', instance: 'norte-test', data: { state: 'close' } },
      });
    } finally {
      restore();
    }

    expect(logs.join('')).not.toContain(ALERT_EMAIL);
  });
});
