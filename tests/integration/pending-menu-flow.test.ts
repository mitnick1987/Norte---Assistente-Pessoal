import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp, type App } from '../../src/app.js';
import { buildTestEnv } from '../factories/test-app.js';
import { jsonResponse, stubFetch, type FetchCall } from '../factories/fetch-stub.js';
import { anthropicErrorResponse } from '../factories/anthropic-stub.js';

const OWNER_JID = '5511999999999@s.whatsapp.net';
const FIXED_NOW = new Date('2026-08-30T23:00:00.000Z'); // noite em America/Sao_Paulo

function textWebhookPayload(waMessageId: string, text: string) {
  return {
    event: 'messages.upsert',
    instance: 'norte-test',
    data: { key: { remoteJid: OWNER_JID, id: waMessageId, fromMe: false }, message: { conversation: text } },
  };
}

function createOverdueItem(app: App, title: string): number {
  const result = app.db
    .prepare(`INSERT INTO items (type, title, origin, status, due_at) VALUES ('tarefa', ?, 'texto', 'ativa', ?)`)
    .run(title, '2026-08-30T10:00:00.000Z');
  return Number(result.lastInsertRowid);
}

function createStaleItem(app: App, title: string): number {
  // snooze_count >= 3: elegível a higiene (RF-11) direto, sem depender de 21 dias parado.
  const result = app.db
    .prepare(`INSERT INTO items (type, title, origin, status, snooze_count) VALUES ('tarefa', ?, 'texto', 'ativa', 3)`)
    .run(title);
  return Number(result.lastInsertRowid);
}

function forceChargeJobDue(app: App): void {
  app.db.prepare(`UPDATE jobs SET next_run_at = ? WHERE type = 'cobranca'`).run(new Date(FIXED_NOW.getTime() - 1000).toISOString());
}

function forceReviewJobDue(app: App): void {
  app.db.prepare(`UPDATE jobs SET next_run_at = ? WHERE type = 'revisao'`).run(new Date(FIXED_NOW.getTime() - 1000).toISOString());
}

function routedStub(anthropicHandler: (call: FetchCall) => Response) {
  return stubFetch((call: FetchCall) => {
    if (call.url.includes('api.anthropic.com')) return anthropicHandler(call);
    return jsonResponse(200, { status: 'success' });
  });
}

/**
 * Achado de review: o menu numérico "1/2/3" tinha um único dono (cobrança) —
 * uma cobrança pendente de mais cedo sequestrava o dígito de QUALQUER menu
 * numérico emitido depois (revisão, higiene), completando/dropando o item
 * errado silenciosamente. `pending_menus` (core) resolve isso: o "1/2/3"
 * sempre age sobre a ÚLTIMA pergunta de menu feita, nunca sempre sobre a
 * cobrança.
 */
describe('desambiguação do menu 1/2/3 entre cobrança, revisão e higiene (achado de review, FEAT-007)', () => {
  let app: App | undefined;

  afterEach(async () => {
    if (app) await app.stop();
    vi.unstubAllGlobals();
  });

  it('cenário exato do achado: cobrança de manhã pendente + menu de higiene à noite + "1" age sobre o item da HIGIENE, nunca completa o item da cobrança', async () => {
    stubFetch(() => jsonResponse(200, { status: 'success' }));
    app = buildApp(buildTestEnv(), { outboxSleep: async () => undefined, provisionWebhook: false, now: () => FIXED_NOW });
    await app.start();

    const chargedItemId = createOverdueItem(app, 'pagar boleto');
    forceChargeJobDue(app);
    await app.scheduler.tick();

    // confirma que a cobrança de fato saiu e ficou pendente de resposta.
    const chargeRow = app.db.prepare(`SELECT COUNT(*) as c FROM nudges_charges WHERE responded_at IS NULL`).get() as { c: number };
    expect(chargeRow.c).toBe(1);

    // à noite, um item elegível a higiene dispara a proposta na revisão —
    // ESTA passa a ser a última pergunta de menu numérico feita.
    const hygieneItemId = createStaleItem(app, 'projeto parado');
    routedStub(() => anthropicErrorResponse(500)); // fallback determinístico, sem depender do Sonnet
    forceReviewJobDue(app);
    await app.scheduler.tick();

    const pendingMenuRow = app.db.prepare(`SELECT origin, item_id FROM pending_menus WHERE resolved_at IS NULL ORDER BY id DESC LIMIT 1`).get() as
      | { origin: string; item_id: number }
      | undefined;
    expect(pendingMenuRow).toEqual({ origin: 'higiene', item_id: hygieneItemId });

    // o dono responde "1" pensando na proposta de higiene (1 = arquivar).
    const response = await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': 'a'.repeat(32) },
      payload: textWebhookPayload('wa-1', '1'),
    });
    expect(response.statusCode).toBe(200);
    await app.waitForPendingProcessing();

    const hygieneItemRow = app.db.prepare('SELECT status FROM items WHERE id = ?').get(hygieneItemId) as { status: string };
    const chargedItemRow = app.db.prepare('SELECT status FROM items WHERE id = ?').get(chargedItemId) as { status: string };

    // "1" resolveu a higiene (1 = arquivar) — nunca a cobrança (1 = feito).
    expect(hygieneItemRow.status).toBe('arquivada');
    expect(chargedItemRow.status).toBe('ativa');
  });

  it('sem nenhum menu de revisão/higiene pendente, "1" continua resolvendo a cobrança normalmente (comportamento pré-existente preservado)', async () => {
    stubFetch(() => jsonResponse(200, { status: 'success' }));
    app = buildApp(buildTestEnv(), { outboxSleep: async () => undefined, provisionWebhook: false, now: () => FIXED_NOW });
    await app.start();

    const itemId = createOverdueItem(app, 'pagar boleto');
    forceChargeJobDue(app);
    await app.scheduler.tick();

    await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': 'a'.repeat(32) },
      payload: textWebhookPayload('wa-1', '1'),
    });
    await app.waitForPendingProcessing();

    const row = app.db.prepare('SELECT status FROM items WHERE id = ?').get(itemId) as { status: string };
    expect(row.status).toBe('feita');
  });
});
