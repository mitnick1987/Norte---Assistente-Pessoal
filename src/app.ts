import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
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
  provisionEvolutionWebhook,
  recoverPendingMessages,
} from './core/channel/whatsapp-evolution/index.js';
import { registerHealthRoute } from './core/health/index.js';
import { EmailAlerter } from './infra-ops/index.js';
import { AnthropicApiKeyProvider } from './core/llm/index.js';
import { GroqSttProvider, OpenAiWhisperProvider, SttRouter } from './core/stt/index.js';
import { buildTasksModule } from './modules/tasks/public/index.js';
import {
  buildCaptureModule,
  PENDING_RECOVERY_THRESHOLD_MS_SETTING,
  PENDING_RECOVERY_MAX_PER_BOOT_SETTING,
} from './modules/capture/manifest.js';

const OUTBOX_INTERVAL_MS = 5_000;
const PENDING_PROCESSING_POLL_MS = 20;

/**
 * npm_package_version só existe quando o processo nasce de `npm run` — o
 * container roda `node dist/app.js` direto (infra/Dockerfile), então a env
 * var nunca chega lá. Resolvemos por import.meta.url em vez de cwd: em
 * dist/app.js o package.json vive um nível acima; em dev (tsx, src/app.ts)
 * idem, um nível acima da raiz do código-fonte.
 */
function resolveBuildVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const raw = readFileSync(join(here, '..', 'package.json'), 'utf-8');
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === 'string' && parsed.version.length > 0 ? parsed.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

const BUILD_VERSION = resolveBuildVersion();

export interface App {
  readonly fastify: FastifyInstance;
  /** Exposto para teste de integração acionar sem depender de timer real (TESTING.md §2/§7). */
  readonly outboxProcessor: OutboxProcessor;
  readonly scheduler: Scheduler;
  readonly db: Database;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  /**
   * Só para teste (ADR-018): o processamento da mensagem roda em background,
   * disparado sem `await` pelo webhook — o `inject()` retorna antes dele
   * terminar. Faz polling no status em `messages` até não sobrar nenhuma
   * `pending`, nunca usado no boot real (TESTING.md §7).
   */
  waitForPendingProcessing: (timeoutMs?: number) => Promise<void>;
}

export interface BuildAppOverrides {
  /** Só para teste de integração — nunca usado no boot real (TESTING.md §7). */
  readonly outboxSleep?: (ms: number) => Promise<void>;
  readonly outboxRandom?: () => number;
  /** Desliga o autoprovisionamento do webhook — testes de integração não têm Evolution real para chamar. */
  readonly provisionWebhook?: boolean;
  /** Relógio fixo da triagem (prompt + resolução de dueExpression) e da seleção de tom — nunca usado no boot real. */
  readonly now?: () => Date;
}

export function buildApp(env: Env, overrides: BuildAppOverrides = {}): App {
  const logger = createLogger(env.NODE_ENV);
  const db = openDatabase(env.DB_PATH);

  // tasks nasce primeiro: capture depende do ItemService dela (contrato
  // público, ARCHITECTURE.md §2) para gravar itens sem SQL direto.
  const { manifest: tasksManifest, service: itemService } = buildTasksModule(db);

  const jobRepository = new JobRepository(db);
  const outboxRepository = new OutboxRepository(db);
  const messageRepository = new MessageRepository(db);
  const settings = new SettingsStore(db);

  const llmProvider = new AnthropicApiKeyProvider({ apiKey: env.ANTHROPIC_API_KEY });

  // core/stt (ADR-017, mesmo desenho de core/llm): GROQ_API_KEY ausente
  // desativa o primário (o router nem tenta chamá-lo); OPENAI_API_KEY
  // ausente só desativa o fallback — nenhuma das duas é erro de boot.
  const sttRouter = new SttRouter({
    primary: env.GROQ_API_KEY ? new GroqSttProvider({ apiKey: env.GROQ_API_KEY }) : undefined,
    fallback: env.OPENAI_API_KEY ? new OpenAiWhisperProvider({ apiKey: env.OPENAI_API_KEY }) : undefined,
    logger,
  });

  const evolutionClient = new EvolutionClient({
    baseUrl: env.EVOLUTION_API_URL,
    apiKey: env.EVOLUTION_API_KEY,
    instance: env.EVOLUTION_INSTANCE,
  });

  const {
    manifest: captureManifest,
    dispatch: dispatchCapture,
    dispatchAudio,
    recoverAudio,
  } = buildCaptureModule({
    llmProvider,
    sttRouter,
    mediaFetcher: evolutionClient,
    itemService,
    jobRepository,
    outboxRepository,
    messageRepository,
    settings,
    ownerJid: env.OWNER_WHATSAPP_JID,
    logger,
    db,
    ...(overrides.now ? { now: overrides.now } : {}),
  });

  const registry = new KernelRegistry();
  registry.register(tasksManifest);
  registry.register(captureManifest);

  runMigrations(db, [...coreMigrations, ...registry.getMigrations()]);

  const eventBus = new EventBus<Record<string, unknown>>();
  registry.wireEvents(eventBus);

  settings.seedDefaults(registry.getSettingsDefaults());

  const scheduler = new Scheduler({
    repository: jobRepository,
    jobHandlers: registry.getJobHandlers(),
    logger,
  });

  const connectionWatchdog = new ConnectionWatchdog();

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
    onUnmatchedText: dispatchCapture,
    onAudioMessage: dispatchAudio,
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
      // Mesmo espírito do catch-up de jobs (ADR-004): mensagem `pending`
      // sobrevivente a um crash no meio de triagem→captura→confirmação é
      // reprocessada aqui, antes do processo voltar a aceitar webhooks novos
      // (ADR-018). Reusa o mesmo caminho de processamento do fluxo normal —
      // nenhuma lógica de dispatch duplicada.
      const thresholdMs =
        settings.get<number>(PENDING_RECOVERY_THRESHOLD_MS_SETTING) ??
        registry.getSettingsDefaults()[PENDING_RECOVERY_THRESHOLD_MS_SETTING];
      const maxPerBoot =
        settings.get<number>(PENDING_RECOVERY_MAX_PER_BOOT_SETTING) ??
        registry.getSettingsDefaults()[PENDING_RECOVERY_MAX_PER_BOOT_SETTING];
      await recoverPendingMessages(
        {
          messageRepository,
          ownerJid: env.OWNER_WHATSAPP_JID,
          commands: registry.getCommands(),
          outboxRepository,
          onUnmatchedText: dispatchCapture,
          onAudioRecovery: recoverAudio,
          logger,
        },
        Number(thresholdMs),
        Number(maxPerBoot),
      );

      await scheduler.runCatchUp();
      scheduler.start();

      outboxTimer = setInterval(() => {
        outboxProcessor.processPending().catch((err: unknown) => {
          logger.error({ err }, 'falha ao processar outbox');
        });
      }, OUTBOX_INTERVAL_MS);
      outboxTimer.unref();

      await fastify.listen({ port: env.PORT, host: env.HOST });

      // Dispara depois do listen (o brain já está pronto para receber) e
      // sem bloquear o boot: a Evolution pode demorar a aceitar chamadas de
      // API mesmo já respondendo ao healthcheck, e isso não pode atrasar o
      // brain a ficar no ar. Erros e retries já ficam logados dentro da
      // própria função — nunca falha em silêncio (SECURITY.md §6).
      if (overrides.provisionWebhook !== false) {
        void provisionEvolutionWebhook(
          {
            evolutionApiUrl: env.EVOLUTION_API_URL,
            evolutionApiKey: env.EVOLUTION_API_KEY,
            instance: env.EVOLUTION_INSTANCE,
            webhookUrl: env.BRAIN_WEBHOOK_URL,
            webhookSecret: env.EVOLUTION_WEBHOOK_SECRET,
          },
          logger,
        );
      }
    },
    async stop() {
      scheduler.stop();
      if (outboxTimer) clearInterval(outboxTimer);
      await fastify.close();
      db.close();
    },
    async waitForPendingProcessing(timeoutMs = 5_000) {
      const deadline = Date.now() + timeoutMs;
      while (messageRepository.findPendingInbound().length > 0) {
        if (Date.now() >= deadline) {
          throw new Error('waitForPendingProcessing: timeout esperando processamento em background terminar');
        }
        await new Promise((resolve) => setTimeout(resolve, PENDING_PROCESSING_POLL_MS));
      }
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
