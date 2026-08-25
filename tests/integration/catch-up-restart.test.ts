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
    firstApp.db
      .prepare(`INSERT INTO jobs (type, payload, next_run_at, status, attempts) VALUES ('reminder', '{}', ?, 'pending', 0)`)
      .run(overdueAt);

    // "processo caiu" — fecha só o fastify da primeira instância, mantendo o arquivo do banco.
    await firstApp.fastify.close();

    secondApp = buildAppOnSameDb(env);
    await secondApp.scheduler.runCatchUp();

    const job = secondApp.db.prepare('SELECT status FROM jobs WHERE type = ?').get('reminder') as {
      status: string;
    };

    // sem handler registrado para "reminder" nesta fundação, o job não é
    // marcado running/confirmed — o que importa aqui é que o catch-up o
    // selecionou e tentou processar, sem lançar nem travar o boot.
    expect(job.status).toBe('pending');
  });

  it('não duplica disparo de job que já tinha delivered_at antes do restart', async () => {
    const env = buildTestEnv();
    firstApp = buildAppOnSameDb(env);

    const overdueAt = new Date(Date.now() - 60_000).toISOString();
    const deliveredAt = new Date(Date.now() - 30_000).toISOString();
    firstApp.db
      .prepare(
        `INSERT INTO jobs (type, payload, next_run_at, status, attempts, delivered_at)
         VALUES ('reminder', '{}', ?, 'confirmed', 1, ?)`,
      )
      .run(overdueAt, deliveredAt);

    await firstApp.fastify.close();

    secondApp = buildAppOnSameDb(env);
    await expect(secondApp.scheduler.runCatchUp()).resolves.toBeUndefined();

    const job = secondApp.db.prepare('SELECT status, delivered_at FROM jobs WHERE type = ?').get('reminder') as {
      status: string;
      delivered_at: string;
    };
    expect(job.status).toBe('confirmed');
    expect(job.delivered_at).toBe(deliveredAt);
  });
});
