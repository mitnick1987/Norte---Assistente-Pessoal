import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModuleManifest } from '../../src/core/kernel/types.js';
import { runMigrations } from '../../src/core/db/migrator.js';
import { coreMigrations } from '../../src/core/db/migrations/index.js';
import { EventBus } from '../../src/core/bus/index.js';
import { KernelRegistry } from '../../src/core/kernel/index.js';
import { SettingsStore } from '../../src/core/settings/index.js';
import { JobRepository } from '../../src/core/scheduler/index.js';
import { OutboxRepository } from '../../src/core/outbox/index.js';
import { MessageRepository } from '../../src/core/channel/index.js';
import { AnthropicApiKeyProvider } from '../../src/core/llm/index.js';
import { createLogger } from '../../src/core/logger.js';
import { buildTasksModule } from '../../src/modules/tasks/public/index.js';
import {
  buildChainsModule,
  CHAINS_DESLOCAMENTO_MIN_DEFAULT_DEFAULT,
  CHAINS_DESLOCAMENTO_MIN_DEFAULT_SETTING,
} from '../../src/modules/chains/public/index.js';
import { buildCaptureModule } from '../../src/modules/capture/manifest.js';
import { GoogleCalendarService } from '../../src/modules/integrations/google-calendar/google-calendar-service.js';
import { AuthTokensRepository } from '../../src/modules/integrations/google-calendar/auth-tokens-repository.js';
import { TokenCipher } from '../../src/modules/integrations/google-calendar/token-cipher.js';
import { googleCalendarMigrations } from '../../src/modules/integrations/google-calendar/migrations/index.js';
import { buildGoogleCalendarTools } from '../../src/modules/integrations/google-calendar/tools.js';
import type { GoogleOAuthPort } from '../../src/modules/integrations/google-calendar/google-oauth-client.js';
import { stubFetch, jsonResponse, type FetchCall } from '../factories/fetch-stub.js';
import { anthropicToolUseResponse, anthropicBrainToolUseResponse, anthropicTextResponse } from '../factories/anthropic-stub.js';

const OWNER_JID = '5511999999999@s.whatsapp.net';
const FIXED_NOW = new Date('2026-08-25T13:00:00.000Z'); // terça-feira, 10h America/Sao_Paulo

/**
 * Monta o app inteiro sem HTTP/Fastify (composição manual, mesmo padrão de
 * `buildCaptureTestContext`/`google-calendar-service.test.ts`): a tool
 * `create_event` chama `googleapis`, que usa `node-fetch` internamente (não
 * o `fetch` global que `stubFetch` substitui) — testar a escrita real no
 * Google exigiria mockar uma dependência interna do SDK que nenhum teste
 * deste projeto mocka (mesmo padrão em `google-calendar-service.test.ts`).
 * Aqui a leitura/escrita do Calendar é stubada na interface
 * `GoogleOAuthPort`, e só a chamada ao Sonnet passa pelo `fetch` real
 * stubado — é o que de fato pertence a esta feature testar (o loop de
 * tool-use do brain).
 */
function buildContext(oauthOverrides: Partial<GoogleOAuthPort> = {}) {
  const db = new Database(':memory:');
  const logger = createLogger('test');
  const settings = new SettingsStore(db);
  const eventBus = new EventBus<Record<string, unknown>>({ logger });

  const { manifest: tasksManifest, service: itemService, eventService } = buildTasksModule(db, {
    emit: (event, payload) => eventBus.emit(event, payload),
  });
  const jobRepository = new JobRepository(db);
  const outboxRepository = new OutboxRepository(db);
  const messageRepository = new MessageRepository(db);

  const { manifest: chainsManifest, service: chainService } = buildChainsModule({
    eventService,
    jobRepository,
    settings,
    now: () => FIXED_NOW,
  });

  const llmProvider = new AnthropicApiKeyProvider({ apiKey: 'test-key' });

  const oauthClient: GoogleOAuthPort = {
    buildConsentUrl: vi.fn(),
    exchangeCode: vi.fn(),
    refresh: vi.fn(),
    listEventsToday: vi.fn().mockResolvedValue([]),
    insertEvent: vi.fn(),
    ...oauthOverrides,
  };
  const tokensRepository = new AuthTokensRepository(db);
  const cipher = new TokenCipher(randomBytes(32).toString('base64'));
  const alerter = { alertDeliveryExhausted: vi.fn(), alertRefreshFailure: vi.fn(), alertAnchorRitualCapped: vi.fn() };

  const googleCalendarService = new GoogleCalendarService({
    db,
    tokensRepository,
    oauthClient,
    cipher,
    eventService,
    itemService,
    chainService,
    alerter,
    logger,
    getDeslocamentoMinDefault: () =>
      Number(settings.get<number>(CHAINS_DESLOCAMENTO_MIN_DEFAULT_SETTING) ?? CHAINS_DESLOCAMENTO_MIN_DEFAULT_DEFAULT),
    now: () => FIXED_NOW,
  });
  const googleCalendarManifest: ModuleManifest = {
    name: 'integrations-google-calendar',
    migrations: googleCalendarMigrations,
    tools: buildGoogleCalendarTools(googleCalendarService),
  };

  // eslint-disable-next-line prefer-const -- precisa existir como `let` antes das closures abaixo (mesmo padrão de app.ts).
  let registry: KernelRegistry;
  const { manifest: captureManifest, dispatch } = buildCaptureModule({
    llmProvider,
    sttRouter: undefined as never,
    mediaFetcher: undefined as never,
    itemService,
    eventService,
    chainService,
    jobRepository,
    outboxRepository,
    messageRepository,
    settings,
    ownerJid: OWNER_JID,
    logger,
    db,
    googleCalendarService,
    getBrainTools: () => registry.getTools(),
    getActiveModules: () => registry.getModules(),
    now: () => FIXED_NOW,
  });

  registry = new KernelRegistry();
  registry.register(tasksManifest);
  registry.register(chainsManifest);
  registry.register(captureManifest);
  registry.register(googleCalendarManifest);

  runMigrations(db, [...coreMigrations, ...registry.getMigrations()]);
  settings.seedDefaults(registry.getSettingsDefaults());

  // Token já autorizado — equivalente a ter passado pelo setup OAuth (FEAT-005).
  tokensRepository.upsert({
    provider: 'google_calendar',
    accessTokenEncrypted: cipher.encrypt('access-token-valido'),
    refreshTokenEncrypted: cipher.encrypt('refresh-token-valido'),
    expiry: new Date(FIXED_NOW.getTime() + 3_600_000),
    scopes: 'https://www.googleapis.com/auth/calendar.events',
  });

  return { db, dispatch, outboxRepository, itemService, eventService, jobRepository, oauthClient };
}

describe('conversa → brain → create_event (FEAT-006, integração)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('mensagem de conversa "marca reunião sexta 10h" aciona o brain, que chama create_event e confirma em texto', async () => {
    const ctx = buildContext({
      insertEvent: vi.fn().mockResolvedValue({
        gcalId: 'gcal-reuniao-1',
        title: 'Reunião',
        start: { dateTime: '2026-08-28T10:00:00-03:00' },
        end: { dateTime: '2026-08-28T11:00:00-03:00' },
      }),
    });

    let anthropicCallCount = 0;
    stubFetch((call: FetchCall) => {
      if (!call.url.includes('api.anthropic.com')) return jsonResponse(200, { status: 'success' });
      anthropicCallCount++;
      if (anthropicCallCount === 1) {
        // triagem: classifica como conversa (não é captura direta).
        return anthropicToolUseResponse({ classification: 'conversa' });
      }
      if (anthropicCallCount === 2) {
        // brain decide chamar a tool create_event com data já resolvida (ISO absoluto).
        return anthropicBrainToolUseResponse([
          {
            id: 'tc_1',
            name: 'create_event',
            input: { title: 'Reunião', startAt: '2026-08-28T13:00:00.000Z', endAt: '2026-08-28T14:00:00.000Z' },
          },
        ]);
      }
      // brain responde em texto depois do tool_result.
      return anthropicTextResponse('Marquei a reunião pra sexta às 10h.');
    });

    await ctx.dispatch('marca reunião sexta 10h', OWNER_JID, 1);

    const item = ctx.db.prepare(`SELECT id, type, status FROM items`).get() as { id: number; type: string; status: string };
    expect(item.type).toBe('compromisso');
    expect(item.status).toBe('ativa');

    const event = ctx.db.prepare(`SELECT gcal_id FROM events WHERE item_id = ?`).get(item.id) as { gcal_id: string };
    expect(event.gcal_id).toBe('gcal-reuniao-1');

    const outboxRow = ctx.db.prepare(`SELECT body FROM outbox_messages ORDER BY id DESC LIMIT 1`).get() as { body: string };
    expect(outboxRow.body).toBe('Marquei a reunião pra sexta às 10h.');
  });

  it('reentrega do mesmo gcalId (Google idempotente do lado dele) nunca duplica o espelho interno', async () => {
    // Cenário em que o Google devolveria o mesmo gcalId numa reentrega
    // idempotente (ex.: reenvio de uma requisição com o mesmo Idempotency-Key
    // do lado do Google) — o índice único de `events.gcal_id` (migração 006
    // de tasks) é a proteção estrutural contra duplicar o espelho interno.
    const ctx = buildContext({
      insertEvent: vi.fn().mockResolvedValue({
        gcalId: 'gcal-reuniao-2',
        title: 'Reunião',
        start: { dateTime: '2026-08-28T10:00:00-03:00' },
        end: { dateTime: '2026-08-28T11:00:00-03:00' },
      }),
    });

    const script = [
      () => anthropicToolUseResponse({ classification: 'conversa' }),
      () =>
        anthropicBrainToolUseResponse([
          {
            id: 'tc_1',
            name: 'create_event',
            input: { title: 'Reunião', startAt: '2026-08-28T13:00:00.000Z', endAt: '2026-08-28T14:00:00.000Z' },
          },
        ]),
      () => anthropicTextResponse('Marquei.'),
    ];
    let callIndex = 0;
    stubFetch((call: FetchCall) => {
      if (!call.url.includes('api.anthropic.com')) return jsonResponse(200, { status: 'success' });
      const response = script[Math.min(callIndex, script.length - 1)]!();
      callIndex++;
      return response;
    });

    await ctx.dispatch('marca reunião sexta 10h', OWNER_JID, 1);
    callIndex = 0;
    await ctx.dispatch('marca reunião sexta 10h', OWNER_JID, 2);

    const eventsCount = ctx.db.prepare(`SELECT COUNT(*) as c FROM events WHERE gcal_id = 'gcal-reuniao-2'`).get() as {
      c: number;
    };
    expect(eventsCount.c).toBe(1);

    // A segunda chamada tenta gravar item+event+cadeia na mesma transação
    // (google-calendar-service.ts, createEventFromBrain) — o UNIQUE
    // constraint de `events.gcal_id` estoura dentro da transação e o
    // better-sqlite3 desfaz tudo (item incluído), então não sobra item órfão
    // mesmo sem uma idempotência própria do brain (diferente da captura
    // direta, que dedupe por sourceMessageId+sourceItemIndex).
    const itemsCount = ctx.db.prepare(`SELECT COUNT(*) as c FROM items WHERE type = 'compromisso'`).get() as { c: number };
    expect(itemsCount.c).toBe(1);
  });
});
