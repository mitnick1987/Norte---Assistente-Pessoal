import type { FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';
import type { ConnectionWatchdog } from '../channel/whatsapp-evolution/connection-watchdog.js';
import { evaluateSystemHealth } from './domain/index.js';

export interface HealthRouteDeps {
  readonly db: Database;
  readonly connectionWatchdog: ConnectionWatchdog;
  readonly getLastSchedulerTick: () => Date | undefined;
  readonly buildVersion: string;
  /** Janela de tolerância do tick do scheduler (settings) — poll é a cada 30s (ADR-004). */
  readonly getSchedulerStaleAfterMs: () => number;
  now?: () => Date;
}

function checkDatabase(db: Database): 'ok' | 'error' {
  try {
    db.prepare('SELECT 1').get();
    return 'ok';
  } catch {
    return 'error';
  }
}

/**
 * Sem autenticação (SECURITY.md §5) — só estado operacional, consumido
 * pelo watchdog interno e pelo ping do Healthchecks.io. Usa a mesma função
 * de avaliação de saúde do dead man's switch (FEAT-008, Decisões tomadas
 * da spec) — nunca duas implementações divergentes sobre "saudável".
 * `degraded` sai com HTTP 503 (BUG-002/issue #3): antes disso, qualquer
 * subsistema fora do ar era mascarado como `ok` enquanto o DB respondesse.
 */
export function registerHealthRoute(app: FastifyInstance, deps: HealthRouteDeps): void {
  const now = deps.now ?? (() => new Date());

  app.get('/health', async (_request, reply) => {
    const dbStatus = checkDatabase(deps.db);
    const connection = deps.connectionWatchdog.getState();
    const lastSchedulerTick = deps.getLastSchedulerTick();

    const health = evaluateSystemHealth({
      dbStatus,
      lastSchedulerTickAt: lastSchedulerTick,
      whatsappState: connection.state,
      now: now(),
      schedulerStaleAfterMs: deps.getSchedulerStaleAfterMs(),
    });

    if (!health.healthy) reply.code(503);

    return {
      status: health.healthy ? 'ok' : 'degraded',
      db: health.db,
      scheduler: {
        status: health.scheduler,
        lastTickAt: lastSchedulerTick?.toISOString() ?? null,
      },
      whatsapp: {
        status: health.whatsapp,
        state: connection.state,
        lastUpdatedAt: connection.lastUpdatedAt?.toISOString() ?? null,
      },
      version: deps.buildVersion,
    };
  });
}
