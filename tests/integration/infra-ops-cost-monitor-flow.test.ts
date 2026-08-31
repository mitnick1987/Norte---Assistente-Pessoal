import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from '../../src/app.js';
import { buildTestApp } from '../factories/test-app.js';
import { jsonResponse, stubFetch, type FetchCall } from '../factories/fetch-stub.js';

const OWNER_JID = '5511999999999@s.whatsapp.net';
const RESEND_API_KEY = 'test-resend-api-key';
const ALERT_EMAIL = 'dono@example.com';

function insertUsage(app: App, intent: string, cacheReadTokens: number, createdAt: string): void {
  app.db
    .prepare(
      `INSERT INTO messages (direction, jid, intent, tokens_in, tokens_out, cache_read_tokens, created_at)
       VALUES ('in', ?, ?, 1000, 200, ?, ?)`,
    )
    .run(OWNER_JID, intent, cacheReadTokens, createdAt);
}

function insertCostMonitorJob(app: App): void {
  // next_run_at precisa do mesmo formato usado por JobRepository#create
  // (Date#toISOString(), com T/Z) — datetime('now') do SQLite grava
  // '2026-08-30 23:20:16' (sem T/Z), que new Date() interpreta como
  // horário local, não UTC, e o job nunca fica "vencido" na comparação.
  app.db
    .prepare(`INSERT INTO jobs (type, next_run_at, status, attempts) VALUES ('cost_monitor', ?, 'pending', 0)`)
    .run(new Date().toISOString());
}

function stubResend() {
  const resendCalls: FetchCall[] = [];
  stubFetch((call) => {
    if (call.url.includes('api.resend.com')) {
      resendCalls.push(call);
      return jsonResponse(200, { id: 'email_stub_id' });
    }
    return jsonResponse(200, { status: 'success' });
  });
  return resendCalls;
}

/** `infraOps.monthlyBudgetUsd` já foi semeado por `seedDefaults` no boot — ajusta o valor existente, nunca insere linha nova (evita duplicidade de chave). */
function setMonthlyBudgetUsd(app: App, budgetUsd: number): void {
  app.db.prepare(`UPDATE settings SET value = ? WHERE key = 'infraOps.monthlyBudgetUsd'`).run(JSON.stringify(budgetUsd));
}

describe('FEAT-008 — monitor de custo: cache_read=0 repetido dispara alarme', () => {
  let app: App;

  afterEach(async () => {
    await app.fastify.close();
    app.db.close();
    vi.unstubAllGlobals();
  });

  it('N chamadas seguidas ao Sonnet com cache_read=0 disparam o alarme de regressão de cache', async () => {
    const resendCalls = stubResend();
    app = buildTestApp({ RESEND_API_KEY, ALERT_EMAIL });

    const now = new Date().toISOString();
    // threshold default é 3 (CACHE_REGRESSION_THRESHOLD_DEFAULT) — 'conversa' é roteado para Sonnet.
    insertUsage(app, 'conversa', 0, now);
    insertUsage(app, 'conversa', 0, now);
    insertUsage(app, 'conversa', 0, now);
    insertCostMonitorJob(app);

    await app.scheduler.tick();

    const alarmCall = resendCalls.find((call) => (call.init!.body as string).includes('regressão'));
    expect(alarmCall).toBeDefined();
  });

  it('uma única ocorrência isolada de cache_read=0 não dispara o alarme (request legítimo sem histórico)', async () => {
    const resendCalls = stubResend();
    app = buildTestApp({ RESEND_API_KEY, ALERT_EMAIL });

    const now = new Date().toISOString();
    insertUsage(app, 'conversa', 500, now);
    insertUsage(app, 'conversa', 0, now);
    insertUsage(app, 'conversa', 500, now);
    insertCostMonitorJob(app);

    await app.scheduler.tick();

    const alarmCall = resendCalls.find((call) => (call.init!.body as string).includes('regressão'));
    expect(alarmCall).toBeUndefined();
  });

  it('chamadas à triagem (Haiku) com cache_read=0 nunca contam para o alarme (é caminho de Sonnet)', async () => {
    const resendCalls = stubResend();
    app = buildTestApp({ RESEND_API_KEY, ALERT_EMAIL });

    const now = new Date().toISOString();
    insertUsage(app, 'triagem', 0, now);
    insertUsage(app, 'triagem', 0, now);
    insertUsage(app, 'triagem', 0, now);
    insertUsage(app, 'triagem', 0, now);
    insertCostMonitorJob(app);

    await app.scheduler.tick();

    const alarmCall = resendCalls.find((call) => (call.init!.body as string).includes('regressão'));
    expect(alarmCall).toBeUndefined();
  });
});

describe('FEAT-008 — monitor de custo: orçamento mensal excedido dispara alerta', () => {
  let app: App;

  afterEach(async () => {
    await app.fastify.close();
    app.db.close();
    vi.unstubAllGlobals();
  });

  it('projeção acima do orçamento (settings) dispara alertCostBudgetExceeded por e-mail real (stub)', async () => {
    const resendCalls = stubResend();
    app = buildTestApp({ RESEND_API_KEY, ALERT_EMAIL });
    setMonthlyBudgetUsd(app, 0.01); // orçamento propositalmente baixo: qualquer amostra de uso já projeta acima

    const now = new Date().toISOString();
    insertUsage(app, 'conversa', 0, now);
    insertCostMonitorJob(app);

    await app.scheduler.tick();

    const budgetCall = resendCalls.find((call) => (call.init!.body as string).includes('orçamento'));
    expect(budgetCall).toBeDefined();
    const body = JSON.parse(budgetCall!.init!.body as string) as { to: string[] };
    expect(body.to).toEqual([ALERT_EMAIL]);
  });

  it('projeção dentro do orçamento não dispara alerta de custo', async () => {
    const resendCalls = stubResend();
    app = buildTestApp({ RESEND_API_KEY, ALERT_EMAIL });
    setMonthlyBudgetUsd(app, 1_000_000); // orçamento propositalmente alto: nenhuma amostra realista projeta acima

    const now = new Date().toISOString();
    insertUsage(app, 'conversa', 0, now);
    insertCostMonitorJob(app);

    await app.scheduler.tick();

    const budgetCall = resendCalls.find((call) => (call.init!.body as string).includes('orçamento'));
    expect(budgetCall).toBeUndefined();
  });
});
