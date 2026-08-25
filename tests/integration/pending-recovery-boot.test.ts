import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp, type App } from '../../src/app.js';
import { buildTestEnv } from '../factories/test-app.js';
import { jsonResponse, stubFetch, type FetchCall } from '../factories/fetch-stub.js';
import { anthropicToolUseResponse } from '../factories/anthropic-stub.js';

const OWNER_JID = '5511999999999@s.whatsapp.net';

/** `created_at` bem no passado — além de qualquer limiar razoável de recuperação. */
const OLD_TIMESTAMP = '2000-01-01 00:00:00';

function routedStub() {
  return stubFetch((call: FetchCall) => {
    if (call.url.includes('api.anthropic.com')) {
      return anthropicToolUseResponse({ classification: 'captura', items: [{ type: 'nota', title: 'ideia antiga' }] });
    }
    return jsonResponse(200, { status: 'success' });
  });
}

/** Insere direto no DB, sem passar pelo webhook — simula mensagem persistida antes de um crash. */
function insertStalePendingMessage(app: App, waMessageId: string, body: string): void {
  app.db
    .prepare(
      `INSERT INTO messages (direction, wa_message_id, jid, body, processing_status, created_at)
       VALUES ('in', ?, ?, ?, 'pending', ?)`,
    )
    .run(waMessageId, OWNER_JID, body, OLD_TIMESTAMP);
}

describe('varredura de recuperação de mensagens pendentes no boot (ADR-018)', () => {
  let app: App | undefined;

  afterEach(async () => {
    if (app) await app.stop();
    vi.unstubAllGlobals();
  });

  it('reprocessa no boot uma mensagem pending antiga: item criado e confirmação enfileirada', async () => {
    const env = buildTestEnv({ PORT: 0 });
    app = buildApp(env, { outboxSleep: async () => undefined, provisionWebhook: false });

    insertStalePendingMessage(app, 'wa-stale-1', 'anota uma ideia antiga');
    routedStub();

    await app.start();

    const message = app.db.prepare(`SELECT processing_status FROM messages WHERE wa_message_id = 'wa-stale-1'`).get() as {
      processing_status: string;
    };
    expect(message.processing_status).toBe('processed');

    const item = app.db.prepare('SELECT title FROM items').get() as { title: string } | undefined;
    expect(item?.title).toBe('ideia antiga');

    const outboxCount = app.db.prepare('SELECT COUNT(*) as c FROM outbox_messages').get() as { c: number };
    expect(outboxCount.c).toBe(1);
  });

  it('rodar a varredura duas vezes (dois boots) não duplica o item (idempotência via source_message_id)', async () => {
    const env = buildTestEnv({ PORT: 0 });
    app = buildApp(env, { outboxSleep: async () => undefined, provisionWebhook: false });

    insertStalePendingMessage(app, 'wa-stale-2', 'anota outra ideia antiga');
    routedStub();

    await app.start();

    const itemCountAfterFirstBoot = app.db.prepare('SELECT COUNT(*) as c FROM items').get() as { c: number };
    expect(itemCountAfterFirstBoot.c).toBe(1);

    // Simula um segundo restart em que, por algum motivo, a mensagem volta a
    // ficar `pending` (ex.: falha registrada tarde demais) — a varredura do
    // segundo boot roda de novo sobre o MESMO arquivo de banco, exercitando
    // o dispatchCapture real do módulo capture, não uma chamada isolada.
    app.db.prepare(`UPDATE messages SET processing_status = 'pending' WHERE wa_message_id = 'wa-stale-2'`).run();
    await app.stop();

    const secondBootApp = buildApp(env, { outboxSleep: async () => undefined, provisionWebhook: false });
    await secondBootApp.start();
    app = secondBootApp;

    const itemCountAfterSecondBoot = app.db.prepare('SELECT COUNT(*) as c FROM items').get() as { c: number };
    expect(itemCountAfterSecondBoot.c).toBe(1);

    const message = app.db.prepare(`SELECT processing_status FROM messages WHERE wa_message_id = 'wa-stale-2'`).get() as {
      processing_status: string;
    };
    expect(message.processing_status).toBe('processed');
  });

  it('não reprocessa mensagem pending recente (dentro do limiar) — evita corrida com processamento em andamento', async () => {
    const env = buildTestEnv({ PORT: 0 });
    app = buildApp(env, { outboxSleep: async () => undefined, provisionWebhook: false });

    // created_at = agora (default da coluna) — bem abaixo do limiar de 60s.
    app.db
      .prepare(
        `INSERT INTO messages (direction, wa_message_id, jid, body, processing_status)
         VALUES ('in', 'wa-fresh-1', ?, 'texto recente', 'pending')`,
      )
      .run(OWNER_JID);
    routedStub();

    await app.start();

    const message = app.db.prepare(`SELECT processing_status FROM messages WHERE wa_message_id = 'wa-fresh-1'`).get() as {
      processing_status: string;
    };
    expect(message.processing_status).toBe('pending');
  });
});
