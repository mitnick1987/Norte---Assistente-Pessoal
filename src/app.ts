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
import { PendingMenuRepository } from './core/menu/index.js';
import {
  EvolutionClient,
  ConnectionWatchdog,
  registerEvolutionWebhookRoute,
  provisionEvolutionWebhook,
  recoverPendingMessages,
} from './core/channel/whatsapp-evolution/index.js';
import { registerHealthRoute } from './core/health/index.js';
import {
  EmailAlerter,
  buildMailer,
  AlertDispatchRepository,
  buildInfraOpsModule,
  DEAD_MANS_SWITCH_JOB_TYPE,
  COST_MONITOR_JOB_TYPE,
  DEAD_MANS_SWITCH_INTERVAL_MINUTES_SETTING,
  COST_MONITOR_INTERVAL_MINUTES_SETTING,
  SCHEDULER_STALE_AFTER_MS_SETTING,
  SCHEDULER_STALE_AFTER_MS_DEFAULT,
  ALERT_ANTI_FLOOD_WINDOW_MS_SETTING,
  ALERT_ANTI_FLOOD_WINDOW_MS_DEFAULT,
  ensureRecurringJob,
} from './infra-ops/index.js';
import { AnthropicApiKeyProvider, type LlmUsage } from './core/llm/index.js';
import { GroqSttProvider, OpenAiWhisperProvider, SttRouter } from './core/stt/index.js';
import { buildTasksModule } from './modules/tasks/public/index.js';
import { buildChainsModule } from './modules/chains/public/index.js';
import {
  buildCaptureModule,
  PENDING_RECOVERY_THRESHOLD_MS_SETTING,
  PENDING_RECOVERY_MAX_PER_BOOT_SETTING,
} from './modules/capture/manifest.js';
import { buildGoogleCalendarModule, registerGoogleCalendarSetupRoutes } from './modules/integrations/google-calendar/public/index.js';
import {
  CHAINS_DESLOCAMENTO_MIN_DEFAULT_DEFAULT,
  CHAINS_DESLOCAMENTO_MIN_DEFAULT_SETTING,
} from './modules/chains/public/index.js';
import {
  buildRitualsModule,
  seedRitualJobs,
  BRIEFING_HOUR_SETTING,
  BRIEFING_MINUTE_SETTING,
  REVISAO_HOUR_SETTING,
  REVISAO_MINUTE_SETTING,
} from './modules/rituals/public/index.js';
import { buildHygieneModule } from './modules/hygiene/public/index.js';
import { buildReturnModeModule } from './modules/return-mode/public/index.js';
import {
  buildNudgesModule,
  ensureNudgesJob,
  NUDGES_DAILY_CHARGE_CAP_SETTING,
  NUDGES_FALLBACK_SNOOZE_HOUR_SETTING,
  NUDGES_FALLBACK_SNOOZE_MINUTE_SETTING,
  NUDGES_CHECK_INTERVAL_MINUTES_SETTING,
} from './modules/nudges/public/index.js';
import { buildNextActionModule } from './modules/next-action/public/index.js';

const OUTBOX_INTERVAL_MS = 5_000;
const PENDING_PROCESSING_POLL_MS = 20;
const BRAIN_CONVERSATION_INTENT = 'conversa';

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

  // Nasce antes dos módulos: tasks publica item.dropped/item.rescheduled
  // aqui (ela é fundação, não pode importar chains — ADR-011), chains
  // assina para cancelar/regenerar a cadeia (FEAT-004).
  const eventBus = new EventBus<Record<string, unknown>>({ logger });

  // tasks nasce primeiro: capture/chains dependem do ItemService/EventService
  // dela (contrato público, ARCHITECTURE.md §2) para gravar itens/eventos
  // sem SQL direto.
  const { manifest: tasksManifest, service: itemService, eventService } = buildTasksModule(db, {
    emit: (event, payload) => eventBus.emit(event, payload),
  });

  const jobRepository = new JobRepository(db);
  const outboxRepository = new OutboxRepository(db);
  const messageRepository = new MessageRepository(db);
  const pendingMenuRepository = new PendingMenuRepository(db);
  const settings = new SettingsStore(db);

  // chains nasce antes de capture: a captura de compromisso chama
  // chainService.scheduleForEvent diretamente (Decisões tomadas da FEAT-004).
  const { manifest: chainsManifest, service: chainService } = buildChainsModule({
    eventService,
    jobRepository,
    settings,
    ...(overrides.now ? { now: overrides.now } : {}),
  });

  const llmProvider = new AnthropicApiKeyProvider({ apiKey: env.ANTHROPIC_API_KEY });

  // core/stt (ADR-017, mesmo desenho de core/llm): GROQ_API_KEY ausente
  // desativa o primário (o router nem tenta chamá-lo); OPENAI_API_KEY
  // ausente só desativa o fallback — nenhuma das duas é erro de boot.
  const sttRouter = new SttRouter({
    primary: env.GROQ_API_KEY ? new GroqSttProvider({ apiKey: env.GROQ_API_KEY, logger }) : undefined,
    fallback: env.OPENAI_API_KEY ? new OpenAiWhisperProvider({ apiKey: env.OPENAI_API_KEY, logger }) : undefined,
    logger,
  });

  const evolutionClient = new EvolutionClient({
    baseUrl: env.EVOLUTION_API_URL,
    apiKey: env.EVOLUTION_API_KEY,
    instance: env.EVOLUTION_INSTANCE,
  });

  // Transporte real (FEAT-008): SMTP tem prioridade sobre Resend quando os
  // dois estão configurados (build-mailer.ts). Sem nenhum dos dois, `mailer`
  // fica undefined e o EmailAlerter cai em log `error` — nunca falha em
  // silêncio (spec item 1).
  const mailer = buildMailer({
    smtpUrl: env.SMTP_URL,
    resendApiKey: env.RESEND_API_KEY,
    alertEmailFrom: env.ALERT_EMAIL_FROM,
    alertEmail: env.ALERT_EMAIL,
  });
  const alertDispatchRepository = new AlertDispatchRepository(db);
  const alerter = new EmailAlerter(
    {
      alertEmail: env.ALERT_EMAIL,
      getAntiFloodWindowMs: () =>
        Number(settings.get<number>(ALERT_ANTI_FLOOD_WINDOW_MS_SETTING) ?? ALERT_ANTI_FLOOD_WINDOW_MS_DEFAULT),
    },
    mailer,
    alertDispatchRepository,
    logger,
    overrides.now ?? (() => new Date()),
  );

  // Credenciais OAuth ausentes não podem derrubar o boot (spec item 5): o
  // setup é manual e único, feito bem depois do primeiro `docker compose up`.
  // Sem elas o módulo simplesmente não nasce — nenhuma rota de setup, nenhuma
  // migração de auth_tokens rodando "no vazio" à toa (ela só faz sentido
  // quando o resto da config existe).
  const googleCalendarConfig =
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REDIRECT_URI && env.TOKEN_ENCRYPTION_KEY
      ? {
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
          redirectUri: env.GOOGLE_REDIRECT_URI,
          tokenEncryptionKey: env.TOKEN_ENCRYPTION_KEY,
        }
      : undefined;

  const googleCalendarModule = googleCalendarConfig
    ? buildGoogleCalendarModule({
        db,
        config: googleCalendarConfig,
        eventService,
        itemService,
        chainService,
        alerter,
        logger,
        getDeslocamentoMinDefault: () =>
          Number(settings.get<number>(CHAINS_DESLOCAMENTO_MIN_DEFAULT_SETTING) ?? CHAINS_DESLOCAMENTO_MIN_DEFAULT_DEFAULT),
        ...(overrides.now ? { now: overrides.now } : {}),
      })
    : undefined;

  // `registry` é declarado antes de `capture` para os thunks
  // `getBrainTools`/`getActiveModules` fecharem sobre a mesma instância que
  // vai receber `register()` logo abaixo — em tempo de request (quando o
  // dispatcher de fato chama o brain) o registry já está completo, mesmo que
  // no instante em que `buildCaptureModule` roda ele ainda esteja vazio
  // (FEAT-006: `capture` não pode importar `google-calendar`/`rituals`
  // diretamente, então não há como montar a lista de tools antes de todos os
  // módulos existirem).
  // eslint-disable-next-line prefer-const -- atribuído uma única vez, mas precisa existir como `let` antes das closures abaixo capturarem o binding (elas só leem o valor quando chamadas, bem depois da atribuição real).
  let registry: KernelRegistry;

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
    eventService,
    chainService,
    jobRepository,
    outboxRepository,
    messageRepository,
    settings,
    ownerJid: env.OWNER_WHATSAPP_JID,
    logger,
    db,
    ...(googleCalendarModule ? { googleCalendarService: googleCalendarModule.service } : {}),
    getBrainTools: () => registry.getTools(),
    getActiveModules: () => registry.getModules(),
    onBrainUsage: (usage) =>
      messageRepository.recordLlmUsage({
        jid: env.OWNER_WHATSAPP_JID,
        intent: BRAIN_CONVERSATION_INTENT,
        tokensIn: usage.tokensIn,
        tokensOut: usage.tokensOut,
        cacheReadTokens: usage.cacheReadTokens,
      }),
    ...(overrides.now ? { now: overrides.now } : {}),
  });

  // return-mode nasce antes de nudges/rituals: os dois consultam
  // `returnModeService`/`hygieneService` como dependência, nunca importando
  // um módulo do outro diretamente (ARCHITECTURE.md §2).
  const { manifest: returnModeManifest, service: returnModeService } = buildReturnModeModule({
    messageRepository,
    itemService,
    ...(overrides.now ? { now: overrides.now } : {}),
  });

  const { manifest: hygieneManifest, service: hygieneService } = buildHygieneModule({
    itemService,
    pendingMenuRepository,
    ...(overrides.now ? { now: overrides.now } : {}),
  });

  // `service` não é consumido aqui: o job `cobranca` e os comandos "1/2/3"
  // já saem prontos no manifesto (mesmo padrão de `chainsManifest`/
  // `ritualsManifest` — só `chainService` é exceção por ser chamado direto
  // do fluxo de captura, ver comentário acima).
  const { manifest: nudgesManifest } = buildNudgesModule({
    db,
    itemService,
    outboxRepository,
    pendingMenuRepository,
    returnModeService,
    ownerJid: env.OWNER_WHATSAPP_JID,
    logger,
    getDailyChargeCap: () => Number(settings.get<number>(NUDGES_DAILY_CHARGE_CAP_SETTING) ?? 3),
    getDailyProactiveCap: () => env.DAILY_PROACTIVE_CAP,
    getFallbackSnoozeHour: () => Number(settings.get<number>(NUDGES_FALLBACK_SNOOZE_HOUR_SETTING) ?? 9),
    getFallbackSnoozeMinute: () => Number(settings.get<number>(NUDGES_FALLBACK_SNOOZE_MINUTE_SETTING) ?? 0),
    ...(overrides.now ? { now: overrides.now } : {}),
  });

  const { manifest: nextActionManifest } = buildNextActionModule({ itemService });

  const ritualsModuleDeps = {
    itemService,
    jobRepository,
    outboxRepository,
    pendingMenuRepository,
    llmProvider,
    getActiveModules: () => registry.getModules(),
    ownerJid: env.OWNER_WHATSAPP_JID,
    logger,
    ...(googleCalendarModule ? { agendaPort: googleCalendarModule.service } : {}),
    hygieneService,
    onUsage: (usage: LlmUsage, intent: 'briefing' | 'revisao') =>
      messageRepository.recordLlmUsage({
        jid: env.OWNER_WHATSAPP_JID,
        intent,
        tokensIn: usage.tokensIn,
        tokensOut: usage.tokensOut,
        cacheReadTokens: usage.cacheReadTokens,
      }),
    getBriefingHour: () => Number(settings.get<number>(BRIEFING_HOUR_SETTING) ?? 7),
    getBriefingMinute: () => Number(settings.get<number>(BRIEFING_MINUTE_SETTING) ?? 40),
    getRevisaoHour: () => Number(settings.get<number>(REVISAO_HOUR_SETTING) ?? 21),
    getRevisaoMinute: () => Number(settings.get<number>(REVISAO_MINUTE_SETTING) ?? 30),
    ...(overrides.now ? { now: overrides.now } : {}),
  };

  const { manifest: ritualsManifest } = buildRitualsModule(ritualsModuleDeps);

  // Nasce antes do registry por não conhecer módulos (ARCHITECTURE.md §2) —
  // o watchdog só precisa existir a tempo de `onStateChange` acionar o
  // alerter na primeira mudança de estado observada.
  const connectionWatchdog = new ConnectionWatchdog({
    onStateChange: (state) => {
      // Só alerta em estado que exige ação humana de fato — 'close' (sessão
      // caída) e 'qr_requested' (precisa re-scan). 'connecting' é reconexão
      // de rotina que o Baileys resolve sozinho o tempo todo (a cada
      // instabilidade de rede ele passa por 'connecting' antes de 'open' de
      // novo); alertar nesse estado é falso positivo, não sinal real.
      // 'unknown' é o estado inicial em memória, nunca uma transição real
      // observada — alertar aqui seria ruído em todo boot do processo.
      if (state !== 'close' && state !== 'qr_requested') return;
      void alerter.alertSessionDown({ state }).catch((err: unknown) => {
        logger.error({ err }, 'falha ao processar alerta de sessão caída');
      });
    },
  });

  // eslint-disable-next-line prefer-const -- mesmo padrão de `registry` acima: o thunk `getHealthInput` só lê `scheduler.getLastTickAt()` em tempo de request, bem depois da atribuição abaixo.
  let scheduler: Scheduler;

  function checkDbStatus(): 'ok' | 'error' {
    try {
      db.prepare('SELECT 1').get();
      return 'ok';
    } catch {
      return 'error';
    }
  }

  const { manifest: infraOpsManifest } = buildInfraOpsModule({
    jobRepository,
    messageRepository,
    alerter,
    logger,
    healthchecksPingUrl: env.HEALTHCHECKS_PING_URL,
    getHealthInput: () => ({
      dbStatus: checkDbStatus(),
      lastSchedulerTickAt: scheduler.getLastTickAt(),
      whatsappState: connectionWatchdog.getState().state,
      schedulerStaleAfterMs: Number(
        settings.get<number>(SCHEDULER_STALE_AFTER_MS_SETTING) ?? SCHEDULER_STALE_AFTER_MS_DEFAULT,
      ),
    }),
    getSetting: (key) => settings.get(key),
    diskCheckPath: env.DB_PATH,
    ...(overrides.now ? { now: overrides.now } : {}),
  });

  registry = new KernelRegistry();
  registry.register(tasksManifest);
  registry.register(chainsManifest);
  registry.register(captureManifest);
  registry.register(ritualsManifest);
  registry.register(returnModeManifest);
  registry.register(hygieneManifest);
  registry.register(nudgesManifest);
  registry.register(nextActionManifest);
  registry.register(infraOpsManifest);
  if (googleCalendarModule) registry.register(googleCalendarModule.manifest);

  runMigrations(db, [...coreMigrations, ...registry.getMigrations()]);

  registry.wireEvents(eventBus);

  settings.seedDefaults(registry.getSettingsDefaults());

  scheduler = new Scheduler({
    repository: jobRepository,
    jobHandlers: registry.getJobHandlers(),
    logger,
    ...(overrides.now ? { now: overrides.now } : {}),
  });

  const outboxProcessor = new OutboxProcessor({
    repository: outboxRepository,
    sender: evolutionClient,
    alerter,
    logger,
    dailyProactiveCap: env.DAILY_PROACTIVE_CAP,
    onDelivered: ({ jid, body, isProactive }) => messageRepository.recordOutbound(jid, body, isProactive),
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
    // Modo retorno (RF-10, FEAT-007): toda mensagem de entrada nova passa
    // por aqui antes do processamento normal — decide se é a reativação e
    // enfileira o resumo de reentrada, sem interferir no fluxo de captura.
    onInboundRecorded: (jid, messageId) => {
      const reentryMessage = returnModeService.checkReentry(jid, messageId);
      if (reentryMessage) {
        outboxRepository.enqueue({ jid, body: reentryMessage, isProactive: true });
      }
    },
  });

  registerHealthRoute(fastify, {
    db,
    connectionWatchdog,
    getLastSchedulerTick: () => scheduler.getLastTickAt(),
    buildVersion: BUILD_VERSION,
    getSchedulerStaleAfterMs: () =>
      Number(settings.get<number>(SCHEDULER_STALE_AFTER_MS_SETTING) ?? SCHEDULER_STALE_AFTER_MS_DEFAULT),
    ...(overrides.now ? { now: overrides.now } : {}),
  });

  // Rotas administrativas de setup único (spec FEAT-005, impacto técnico):
  // fora do webhook público, sem filtro de JID — o infra/Caddyfile expõe
  // publicamente só /webhook/evolution* e /health (404 para o resto), então
  // /setup/* só responde a quem chega direto na porta local/túnel SSH.
  if (googleCalendarModule) {
    registerGoogleCalendarSetupRoutes(fastify, googleCalendarModule.service);
  }

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

      // Job durável, nunca cron em memória (ADR-004): seed idempotente da
      // primeira ocorrência de briefing/revisão — a partir daí o próprio
      // scheduler recalcula a recorrência diária no momento do disparo.
      seedRitualJobs(ritualsModuleDeps, jobRepository);

      // Idem para a checagem de cobrança (RF-08, FEAT-007) — recorrência
      // `every` (minutos), não `daily`: precisa reavaliar elegibilidade
      // várias vezes ao dia, não só uma.
      const checkIntervalMinutes =
        settings.get<number>(NUDGES_CHECK_INTERVAL_MINUTES_SETTING) ??
        registry.getSettingsDefaults()[NUDGES_CHECK_INTERVAL_MINUTES_SETTING];
      ensureNudgesJob(jobRepository, Number(checkIntervalMinutes), overrides.now ? overrides.now() : new Date());

      // Dead man's switch e monitor de custo (FEAT-008, RF-13/RF-15): jobs
      // durável na tabela `jobs`, nunca timer solto (ADR-004) — mesmo padrão
      // idempotente dos demais seeds acima.
      const bootNow = overrides.now ? overrides.now() : new Date();
      const deadMansSwitchIntervalMinutes =
        settings.get<number>(DEAD_MANS_SWITCH_INTERVAL_MINUTES_SETTING) ??
        registry.getSettingsDefaults()[DEAD_MANS_SWITCH_INTERVAL_MINUTES_SETTING];
      ensureRecurringJob(jobRepository, DEAD_MANS_SWITCH_JOB_TYPE, Number(deadMansSwitchIntervalMinutes), bootNow);

      const costMonitorIntervalMinutes =
        settings.get<number>(COST_MONITOR_INTERVAL_MINUTES_SETTING) ??
        registry.getSettingsDefaults()[COST_MONITOR_INTERVAL_MINUTES_SETTING];
      ensureRecurringJob(jobRepository, COST_MONITOR_JOB_TYPE, Number(costMonitorIntervalMinutes), bootNow);

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
