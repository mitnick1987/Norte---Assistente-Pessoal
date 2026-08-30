import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from '../../src/app.js';
import { buildTestApp } from '../factories/test-app.js';
import { stubFetch, jsonResponse } from '../factories/fetch-stub.js';

const OWNER_JID = '5511999999999@s.whatsapp.net';
const FIXED_NOW = new Date('2026-08-25T13:00:00.000Z');

function textWebhookPayload(waMessageId: string, text: string) {
  return {
    event: 'messages.upsert',
    instance: 'norte-test',
    data: { key: { remoteJid: OWNER_JID, id: waMessageId, fromMe: false }, message: { conversation: text } },
  };
}

describe('"qual a próxima?" (RF-09, FEAT-007)', () => {
  let app: App | undefined;

  afterEach(async () => {
    if (app) await app.stop();
    vi.unstubAllGlobals();
  });

  it('devolve exatamente UMA ação, resolvida pelo executor determinístico (sem chamar o Sonnet)', async () => {
    stubFetch(() => jsonResponse(200, { status: 'success' }));
    app = buildTestApp({}, { now: () => FIXED_NOW });
    await app.start();

    app.db
      .prepare(`INSERT INTO items (type, title, origin, status, due_at) VALUES ('tarefa', 'pagar boleto', 'texto', 'ativa', ?)`)
      .run('2026-08-26T10:00:00.000Z');
    app.db
      .prepare(`INSERT INTO items (type, title, origin, status, due_at) VALUES ('tarefa', 'revisar contrato', 'texto', 'ativa', ?)`)
      .run('2026-08-30T10:00:00.000Z');

    await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': 'a'.repeat(32) },
      payload: textWebhookPayload('wa-1', 'qual a proxima'),
    });
    await app.waitForPendingProcessing();

    const row = app.db.prepare(`SELECT body FROM outbox_messages WHERE is_proactive = 0 ORDER BY id DESC LIMIT 1`).get() as
      | { body: string }
      | undefined;
    expect(row?.body).toBe('pagar boleto');
  });

  it('"me mostra tudo" continua listando tudo — o comando novo nunca degrada para isso sozinho', async () => {
    stubFetch(() => jsonResponse(200, { status: 'success' }));
    app = buildTestApp({}, { now: () => FIXED_NOW });
    await app.start();

    app.db.prepare(`INSERT INTO items (type, title, origin, status) VALUES ('tarefa', 'item 1', 'texto', 'ativa')`).run();
    app.db.prepare(`INSERT INTO items (type, title, origin, status) VALUES ('tarefa', 'item 2', 'texto', 'ativa')`).run();

    await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': 'a'.repeat(32) },
      payload: textWebhookPayload('wa-1', 'me mostra tudo'),
    });
    await app.waitForPendingProcessing();

    const row = app.db.prepare(`SELECT body FROM outbox_messages WHERE is_proactive = 0 ORDER BY id DESC LIMIT 1`).get() as
      | { body: string }
      | undefined;
    expect(row?.body).toContain('item 1');
    expect(row?.body).toContain('item 2');
  });
});
