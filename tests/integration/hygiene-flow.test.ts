import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp, type App } from '../../src/app.js';
import { buildTestEnv } from '../factories/test-app.js';
import type { Env } from '../../src/core/env.js';
import { jsonResponse, stubFetch, type FetchCall } from '../factories/fetch-stub.js';
import { anthropicErrorResponse } from '../factories/anthropic-stub.js';

const FIXED_NOW = new Date('2026-08-25T10:30:00.000Z');

function startApp(env: Env = buildTestEnv({ PORT: 0 })): App {
  return buildApp(env, { outboxSleep: async () => undefined, provisionWebhook: false, now: () => FIXED_NOW });
}

function routedStub(anthropicHandler: (call: FetchCall) => Response) {
  return stubFetch((call: FetchCall) => {
    if (call.url.includes('api.anthropic.com')) return anthropicHandler(call);
    return jsonResponse(200, { status: 'success' });
  });
}

describe('higiene na revisão noturna (RF-11, FEAT-007)', () => {
  let app: App | undefined;

  afterEach(async () => {
    if (app) await app.stop();
    vi.unstubAllGlobals();
  });

  it('item com 3+ adiamentos presente na véspera do job revisao: revisão inclui a proposta de higiene como a única decisão pedida', async () => {
    app = startApp();
    routedStub(() => jsonResponse(200, { status: 'success' }));
    await app.start();

    app.db
      .prepare(`INSERT INTO items (type, title, origin, status, snooze_count) VALUES ('tarefa', 'projeto parado', 'texto', 'ativa', 3)`)
      .run();

    // Sonnet indisponível: cai no fallback determinístico, que é o que
    // permite verificar a mensagem de higiene sem depender de redação livre.
    routedStub(() => anthropicErrorResponse(500));

    app.db.prepare(`UPDATE jobs SET next_run_at = ? WHERE type = 'revisao'`).run(new Date(FIXED_NOW.getTime() - 1000).toISOString());
    await app.scheduler.tick();

    const rows = app.db.prepare(`SELECT body FROM outbox_messages WHERE is_proactive = 1 ORDER BY id`).all() as {
      body: string;
    }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(3);

    const decisionMessage = rows.find((r) => r.body.includes('arquivar'));
    expect(decisionMessage).toBeDefined();
    expect(decisionMessage!.body).toContain('dropar');
    expect(decisionMessage!.body).toContain('adiar');
  });

  it('mensagem de higiene nunca inclui a contagem de adiamentos (snoozeCount nunca exposto ao usuário)', async () => {
    app = startApp();
    routedStub(() => jsonResponse(200, { status: 'success' }));
    await app.start();

    app.db
      .prepare(`INSERT INTO items (type, title, origin, status, snooze_count) VALUES ('tarefa', 'projeto parado', 'texto', 'ativa', 7)`)
      .run();
    routedStub(() => anthropicErrorResponse(500));
    app.db.prepare(`UPDATE jobs SET next_run_at = ? WHERE type = 'revisao'`).run(new Date(FIXED_NOW.getTime() - 1000).toISOString());

    await app.scheduler.tick();

    const rows = app.db.prepare(`SELECT body FROM outbox_messages WHERE is_proactive = 1`).all() as { body: string }[];
    for (const row of rows) {
      expect(row.body).not.toMatch(/snooze/i);
      expect(row.body).not.toMatch(/\b7\b/);
    }
  });

  it('sem item elegível a higiene, revisão segue com a decisão genérica de sempre (comportamento pré-existente preservado)', async () => {
    app = startApp();
    routedStub(() => jsonResponse(200, { status: 'success' }));
    await app.start();
    routedStub(() => anthropicErrorResponse(500));

    app.db.prepare(`UPDATE jobs SET next_run_at = ? WHERE type = 'revisao'`).run(new Date(FIXED_NOW.getTime() - 1000).toISOString());
    await app.scheduler.tick();

    const rows = app.db.prepare(`SELECT body FROM outbox_messages WHERE is_proactive = 1`).all() as { body: string }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.body.includes('arquivar'))).toBe(false);
  });
});
