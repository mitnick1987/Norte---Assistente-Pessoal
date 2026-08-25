import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import Fastify from 'fastify';
import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import type { Database } from 'better-sqlite3';
import { loadEnv, type Env } from './core/env.js';
import { createLogger } from './core/logger.js';
import { openDatabase, runMigrations, coreMigrations } from './core/db/index.js';
import { EventBus } from './core/bus/index.js';
import { KernelRegistry } from './core/kernel/index.js';
import { SettingsStore } from './core/settings/index.js';
import { JobRepository, Scheduler } from './core/scheduler/index.js';
import { OutboxRepository, OutboxProcessor } from './core/outbox/index.js';
import { MessageRepository } from './core/channel/index.js';
import {
  EvolutionClient,
  ConnectionWatchdog,
  registerEvolutionWebhookRoute,
} from './core/channel/whatsapp-evolution/index.js';
import { registerHealthRoute } from './core/health/index.js';
import { EmailAlerter } from './infra-ops/index.js';
import { echoModule } from './modules/echo/index.js';

// Lista explícita de módulos ativos (ARCHITECTURE.md §2) — M1 liga aqui os
// módulos de domínio conforme forem chegando; por ora só a prova de conceito.
const ACTIVE_MODULES = [echoModule];

const BUILD_VERSION = process.env['npm_package_version'] ?? '0.0.0';
const OUTBOX_INTERVAL_MS = 5_000;

export interface App {
  readonly fastify: FastifyInstance;
  /** Exposto para teste de integração acionar sem depender de timer real (TESTING.md §2/§7). */
  readonly outboxProcessor: OutboxProcessor;
  readonly scheduler: Scheduler;
  readonly db: Database;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

export interface BuildAppOverrides {
  /** Só para teste de integração — nunca usado no boot real (TESTING.md §7). */
  readonly outboxSleep?: (ms: number) => Promise<void>;
  readonly outboxRandom?: () => number;
}

export function buildApp(env: Env, overrides: BuildAppOverrides = {}): App {
  const logger = createLogger(env.NODE_ENV);
  const db = openDatabase(env.DB_PATH);

  const registry = new KernelRegistry();
  for (const module of ACTIVE_MODULES) {
    registry.register(module);
  }

  runMigrations(db, [...coreMigrations, ...registry.getMigrations()]);

  const eventBus = new EventBus<Record<string, unknown>>();
  registry.wireEvents(eventBus);

  const settings = new SettingsStore(db);
  settings.seedDefaults(registry.getSettingsDefaults());

  const jobRepository = new JobRepository(db);
  const scheduler = new Scheduler({
    repository: jobRepository,
    jobHandlers: registry.getJobHandlers(),
    logger,
  });

  const outboxRepository = new OutboxRepository(db);
  const messageRepository = new MessageRepository(db);
  const connectionWatchdog = new ConnectionWatchdog();

  const evolutionClient = new EvolutionClient({
    baseUrl: env.EVOLUTION_API_URL,
    apiKey: env.EVOLUTION_API_KEY,
    instance: env.EVOLUTION_INSTANCE,
  });

  const alerter = new EmailAlerter({ smtpUrl: env.SMTP_URL, alertEmail: env.ALERT_EMAIL }, logger);

  const outboxProcessor = new OutboxProcessor({
    repository: outboxRepository,
    sender: evolutionClient,
    alerter,
    logger,
    dailyProactiveCap: env.DAILY_PROACTIVE_CAP,
    onDelivered: ({ jid, body }) => messageRepository.recordOutbound(jid, body),
    ...(overrides.outboxSleep ? { sleep: overrides.outboxSleep } : {}),
    ...(overrides.outboxRandom ? { random: overrides.outboxRandom } : {}),
  });

  // Anotação explícita do generic de logger: pino.Logger satisfaz FastifyBaseLogger
  // estruturalmente, mas a inferência automática do generic colide sob exactOptionalPropertyTypes.
  const fastify: FastifyInstance = Fastify<Server, IncomingMessage, ServerResponse, FastifyBaseLogger>({
    loggerInstance: logger,
  });

  registerEvolutionWebhookRoute(fastify, {
    webhookSecret: env.EVOLUTION_WEBHOOK_SECRET,
    instance: env.EVOLUTION_INSTANCE,
    ownerJid: env.OWNER_WHATSAPP_JID,
    messageRepository,
    outboxRepository,
    commands: registry.getCommands(),
    connectionWatchdog,
    logger,
  });

  registerHealthRoute(fastify, {
    db,
    connectionWatchdog,
    getLastSchedulerTick: () => scheduler.getLastTickAt(),
    buildVersion: BUILD_VERSION,
  });

  let outboxTimer: NodeJS.Timeout | undefined;

  return {
    fastify,
    outboxProcessor,
    scheduler,
    db,
    async start() {
      await scheduler.runCatchUp();
      scheduler.start();

      outboxTimer = setInterval(() => {
        outboxProcessor.processPending().catch((err: unknown) => {
          logger.error({ err }, 'falha ao processar outbox');
        });
      }, OUTBOX_INTERVAL_MS);
      outboxTimer.unref();

      await fastify.listen({ port: env.PORT, host: '127.0.0.1' });
    },
    async stop() {
      scheduler.stop();
      if (outboxTimer) clearInterval(outboxTimer);
      await fastify.close();
      db.close();
    },
  };
}

async function main(): Promise<void> {
  const env = loadEnv();
  const app = buildApp(env);
  await app.start();
}

// Só sobe o servidor quando executado diretamente — testes de integração
// importam buildApp() e controlam o ciclo de vida sozinhos.
if (process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}`) {
  main().catch((err: unknown) => {
    // Boot falhou antes de o logger existir de forma confiável (env inválido, DB inacessível).
    process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
  });
}
