import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp, type App, type BuildAppOverrides } from '../../src/app.js';
import { buildTestEnv } from '../factories/test-app.js';
import type { Env } from '../../src/core/env.js';

/**
 * Simula restart do processo com job vencido persistido: constrói uma
 * segunda instância de App sobre o MESMO arquivo SQLite, sem reaproveitar
 * nenhum estado em memória da primeira — só assim o catch-up é
 * genuinamente testado (TESTING.md §4.2).
 */
function buildAppOnSameDb(env: Env, overrides: BuildAppOverrides = {}): App {
  return buildApp(env, { outboxSleep: async () => undefined, ...overrides });
}

describe('catch-up de job vencido no boot (ADR-004)', () => {
  let firstApp: App | undefined;
  let secondApp: App | undefined;

  afterEach(async () => {
    if (firstApp) {
      await firstApp.fastify.close();
      firstApp.db.close();
    }
    if (secondApp) {
      await secondApp.fastify.close();
      secondApp.db.close();
    }
    vi.unstubAllGlobals();
  });

  it('dispara no boot um job pending com next_run_at vencido durante o downtime simulado', async () => {
    const env = buildTestEnv();
    firstApp = buildAppOnSameDb(env);

    const overdueAt = new Date(Date.now() - 60_000).toISOString();
    const payload = JSON.stringify({ itemId: 1, title: 'pagar boleto' });
    firstApp.db
      .prepare(`INSERT INTO jobs (type, payload, next_run_at, status, attempts) VALUES ('reminder', ?, ?, 'pending', 0)`)
      .run(payload, overdueAt);

    // "processo caiu" — fecha só o fastify da primeira instância, mantendo o arquivo do banco.
    await firstApp.fastify.close();

    secondApp = buildAppOnSameDb(env);
    await secondApp.scheduler.runCatchUp();

    // handler real do módulo capture (RF-03): job vencido processado no
    // boot enfileira o lembrete no outbox, sem esperar o próximo poll de 30s.
    const outboxRow = secondApp.db.prepare(`SELECT body FROM outbox_messages WHERE body LIKE 'Lembrete:%'`).get() as
      | { body: string }
      | undefined;
    expect(outboxRow?.body).toBe('Lembrete: pagar boleto');
  });

  it('não duplica disparo de job que já tinha delivered_at antes do restart', async () => {
    const env = buildTestEnv();
    firstApp = buildAppOnSameDb(env);

    const overdueAt = new Date(Date.now() - 60_000).toISOString();
    const deliveredAt = new Date(Date.now() - 30_000).toISOString();
    const payload = JSON.stringify({ itemId: 1, title: 'pagar boleto' });
    firstApp.db
      .prepare(
        `INSERT INTO jobs (type, payload, next_run_at, status, attempts, delivered_at)
         VALUES ('reminder', ?, ?, 'confirmed', 1, ?)`,
      )
      .run(payload, overdueAt, deliveredAt);

    await firstApp.fastify.close();

    secondApp = buildAppOnSameDb(env);
    await expect(secondApp.scheduler.runCatchUp()).resolves.toBeUndefined();

    const job = secondApp.db.prepare('SELECT status, delivered_at FROM jobs WHERE type = ?').get('reminder') as {
      status: string;
      delivered_at: string;
    };
    expect(job.status).toBe('confirmed');
    expect(job.delivered_at).toBe(deliveredAt);

    const outboxCount = secondApp.db.prepare('SELECT COUNT(*) as c FROM outbox_messages').get() as { c: number };
    expect(outboxCount.c).toBe(0);
  });
});
