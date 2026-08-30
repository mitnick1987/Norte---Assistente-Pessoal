import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp, type App, type BuildAppOverrides } from '../../src/app.js';
import { buildTestApp, buildTestEnv } from '../factories/test-app.js';
import type { Env } from '../../src/core/env.js';
import { stubFetch, jsonResponse } from '../factories/fetch-stub.js';

const OWNER_JID = '5511999999999@s.whatsapp.net';
const FIXED_NOW = new Date('2026-08-30T15:00:00.000Z'); // domingo 12h America/Sao_Paulo

function textWebhookPayload(waMessageId: string, text: string) {
  return {
    event: 'messages.upsert',
    instance: 'norte-test',
    data: { key: { remoteJid: OWNER_JID, id: waMessageId, fromMe: false }, message: { conversation: text } },
  };
}

function createOverdueItem(app: App, title: string): number {
  const result = app.db
    .prepare(
      `INSERT INTO items (type, title, origin, status, due_at) VALUES ('tarefa', ?, 'texto', 'ativa', ?)`,
    )
    .run(title, '2026-08-30T10:00:00.000Z');
  return Number(result.lastInsertRowid);
}

function forceChargeJobDue(app: App): void {
  app.db.prepare(`UPDATE jobs SET next_run_at = ? WHERE type = 'cobranca'`).run(
    new Date(FIXED_NOW.getTime() - 1000).toISOString(),
  );
}

describe('fechamento de loop (RF-08, FEAT-007, PRD §6 fluxo 5)', () => {
  let app: App;

  beforeEach(async () => {
    stubFetch(() => jsonResponse(200, { status: 'success' }));
    app = buildTestApp({}, { now: () => FIXED_NOW });
    await app.start();
  });

  afterEach(async () => {
    await app.stop();
    vi.unstubAllGlobals();
  });

  it('item com prazo vencido gera cobrança no outbox com menu 1/2/3', async () => {
    createOverdueItem(app, 'pagar boleto');
    forceChargeJobDue(app);

    await app.scheduler.tick();

    const row = app.db.prepare(`SELECT body FROM outbox_messages WHERE is_proactive = 1 ORDER BY id DESC LIMIT 1`).get() as
      | { body: string }
      | undefined;
    expect(row?.body).toBeDefined();
    expect(row!.body).toContain('1) feito');
    expect(row!.body).toContain('2) reagendar');
    expect(row!.body).toContain('3) dropar');
  });

  it('resposta "1" completa o item — status final verificado no SQLite', async () => {
    const itemId = createOverdueItem(app, 'pagar boleto');
    forceChargeJobDue(app);
    await app.scheduler.tick();

    const response = await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': 'a'.repeat(32) },
      payload: textWebhookPayload('wa-1', '1'),
    });
    expect(response.statusCode).toBe(200);
    await app.waitForPendingProcessing();

    const row = app.db.prepare('SELECT status FROM items WHERE id = ?').get(itemId) as { status: string };
    expect(row.status).toBe('feita');
  });

  it('resposta "3" dropa o item (lógico) — status final verificado no SQLite', async () => {
    const itemId = createOverdueItem(app, 'pagar boleto');
    forceChargeJobDue(app);
    await app.scheduler.tick();

    await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': 'a'.repeat(32) },
      payload: textWebhookPayload('wa-1', '3'),
    });
    await app.waitForPendingProcessing();

    const row = app.db.prepare('SELECT status FROM items WHERE id = ?').get(itemId) as { status: string };
    expect(row.status).toBe('dropada');
  });

  it('resposta "2" gera proposta de horário concreto e reagenda o item — nunca pergunta "para quando?"', async () => {
    const itemId = createOverdueItem(app, 'pagar boleto');
    forceChargeJobDue(app);
    await app.scheduler.tick();

    await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': 'a'.repeat(32) },
      payload: textWebhookPayload('wa-1', '2'),
    });
    await app.waitForPendingProcessing();

    const replyRow = app.db
      .prepare(`SELECT body FROM outbox_messages WHERE is_proactive = 0 ORDER BY id DESC LIMIT 1`)
      .get() as { body: string } | undefined;
    expect(replyRow?.body.toLowerCase()).not.toContain('para quando');

    const itemRow = app.db.prepare('SELECT status, due_at FROM items WHERE id = ?').get(itemId) as {
      status: string;
      due_at: string;
    };
    expect(itemRow.status).toBe('adiada');
    expect(new Date(itemRow.due_at).getTime()).toBeGreaterThan(FIXED_NOW.getTime());
  });

  it('teto diário de cobranças aplicado no backend: mais itens vencidos que o teto não gera mais mensagens que o configurado (S3 estendida)', async () => {
    for (let i = 0; i < 6; i++) createOverdueItem(app, `tarefa ${i}`);
    forceChargeJobDue(app);

    await app.scheduler.tick();

    const proactiveCount = app.db.prepare(`SELECT COUNT(*) as c FROM outbox_messages WHERE is_proactive = 1`).get() as {
      c: number;
    };
    expect(proactiveCount.c).toBeLessThanOrEqual(3); // nudges.dailyChargeCap default
  });

  it('teto geral do outbox (DAILY_PROACTIVE_CAP) continua valendo em conjunto com o teto de cobranças — cobrança também conta pro teto geral (S3 estendida, SECURITY.md §2)', async () => {
    await app.stop();
    // teto geral do outbox mais apertado que o de cobranças (default 3):
    // mesmo o job de cobrança gravando as 3 linhas em `nudges_charges`, o
    // outbox processor recusa entregar a 2ª mensagem proativa do dia.
    app = buildTestApp({ DAILY_PROACTIVE_CAP: 1 }, { now: () => FIXED_NOW, outboxSleep: async () => undefined });
    await app.start();

    for (let i = 0; i < 3; i++) createOverdueItem(app, `tarefa ${i}`);
    forceChargeJobDue(app);
    await app.scheduler.tick();
    await app.outboxProcessor.processPending();

    const deliveredCount = app.db.prepare(`SELECT COUNT(*) as c FROM outbox_messages WHERE status = 'delivered'`).get() as {
      c: number;
    };
    expect(deliveredCount.c).toBeLessThanOrEqual(1); // DAILY_PROACTIVE_CAP=1, mais apertado que nudges.dailyChargeCap
  });
});

describe('catch-up do job cobranca no boot (ADR-004, mesmo padrão de reminder/briefing/revisao)', () => {
  function buildAppOnSameDb(env: Env, overrides: BuildAppOverrides = {}): App {
    return buildApp(env, { outboxSleep: async () => undefined, provisionWebhook: false, ...overrides });
  }

  it('job cobranca com next_run_at vencido sobrevive a restart e roda no catch-up', async () => {
    stubFetch(() => jsonResponse(200, { status: 'success' }));
    const env = buildTestEnv();
    const seedingApp = buildAppOnSameDb(env, { now: () => FIXED_NOW });
    await seedingApp.start();
    createOverdueItem(seedingApp, 'pagar boleto');
    forceChargeJobDue(seedingApp);
    await seedingApp.fastify.close();

    const restartedApp = buildAppOnSameDb(env, { now: () => new Date(FIXED_NOW.getTime() + 60_000) });
    await restartedApp.scheduler.runCatchUp();

    const proactiveCount = restartedApp.db
      .prepare(`SELECT COUNT(*) as c FROM outbox_messages WHERE is_proactive = 1`)
      .get() as { c: number };
    expect(proactiveCount.c).toBeGreaterThan(0);

    await restartedApp.fastify.close();
    restartedApp.db.close();
  });
});
