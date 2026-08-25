import type { FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';
import type { ConnectionWatchdog } from '../channel/whatsapp-evolution/connection-watchdog.js';

export interface HealthRouteDeps {
  readonly db: Database;
  readonly connectionWatchdog: ConnectionWatchdog;
  readonly getLastSchedulerTick: () => Date | undefined;
  readonly buildVersion: string;
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
 * pelo watchdog interno e pelo ping do Healthchecks.io.
 */
export function registerHealthRoute(app: FastifyInstance, deps: HealthRouteDeps): void {
  app.get('/health', async () => {
    const dbStatus = checkDatabase(deps.db);
    const connection = deps.connectionWatchdog.getState();
    const lastSchedulerTick = deps.getLastSchedulerTick();

    return {
      status: dbStatus === 'ok' ? 'ok' : 'degraded',
      db: dbStatus,
      scheduler: {
        lastTickAt: lastSchedulerTick?.toISOString() ?? null,
      },
      whatsapp: {
        state: connection.state,
        lastUpdatedAt: connection.lastUpdatedAt?.toISOString() ?? null,
      },
      version: deps.buildVersion,
    };
  });
}
