import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../../src/core/db/migrator.js';
import { coreMigrations } from '../../src/core/db/migrations/index.js';
import { tasksMigrations } from '../../src/modules/tasks/migrations/index.js';
import { googleCalendarMigrations } from '../../src/modules/integrations/google-calendar/migrations/index.js';
import { ItemsRepository } from '../../src/modules/tasks/items-repository.js';
import { ItemService } from '../../src/modules/tasks/item-service.js';
import { EventsRepository } from '../../src/modules/tasks/events-repository.js';
import { EventService } from '../../src/modules/tasks/event-service.js';
import { ChainService } from '../../src/modules/chains/chain-service.js';
import { JobRepository } from '../../src/core/scheduler/index.js';
import { AuthTokensRepository } from '../../src/modules/integrations/google-calendar/auth-tokens-repository.js';
import { TokenCipher } from '../../src/modules/integrations/google-calendar/token-cipher.js';
import { GoogleCalendarService } from '../../src/modules/integrations/google-calendar/google-calendar-service.js';
import { registerGoogleCalendarSetupRoutes } from '../../src/modules/integrations/google-calendar/setup-routes.js';
import type { GoogleOAuthPort } from '../../src/modules/integrations/google-calendar/google-oauth-client.js';
import type { FailureAlerter } from '../../src/core/outbox/index.js';

const ACCESS_TOKEN = 'access-token-nao-pode-vazar-em-log-nem-no-sqlite';
const REFRESH_TOKEN = 'refresh-token-nao-pode-vazar-em-log-nem-no-sqlite';

function captureStdout(): { logs: string[]; restore: () => void } {
  const logs: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- captura raw de stdout só para asserção de log neste teste
  (process.stdout.write as any) = (chunk: string) => {
    logs.push(String(chunk));
    return true;
  };
  return {
    logs,
    restore: () => {
      process.stdout.write = originalWrite;
    },
  };
}

function buildContext() {
  const db = new Database(':memory:');
  runMigrations(db, [...coreMigrations, ...tasksMigrations, ...googleCalendarMigrations]);

  const itemService = new ItemService(new ItemsRepository(db));
  const eventService = new EventService(new EventsRepository(db));
  const jobRepository = new JobRepository(db);
  const chainService = new ChainService({
    eventService,
    jobRepository,
    getSettings: () => ({ vesperaHour: 20, manhaHour: 8, prepMarginMin: 15 }),
  });

  const oauthClient: GoogleOAuthPort = {
    buildConsentUrl: vi.fn(() => 'https://accounts.google.com/consent'),
    exchangeCode: vi.fn().mockResolvedValue({
      accessToken: ACCESS_TOKEN,
      refreshToken: REFRESH_TOKEN,
      expiry: new Date(Date.now() + 3_600_000),
      scopes: 'https://www.googleapis.com/auth/calendar.events',
    }),
    refresh: vi.fn(),
    listEventsToday: vi.fn().mockResolvedValue([]),
    insertEvent: vi.fn(),
  };

  const alerter: FailureAlerter = { alertDeliveryExhausted: vi.fn(), alertRefreshFailure: vi.fn() };

  const logs: unknown[] = [];
  const logger = {
    info: (obj: unknown) => logs.push(obj),
    warn: (obj: unknown) => logs.push(obj),
    error: (obj: unknown) => logs.push(obj),
  } as never;

  const cipher = new TokenCipher(randomBytes(32).toString('base64'));
  const tokensRepository = new AuthTokensRepository(db);

  const service = new GoogleCalendarService({
    tokensRepository,
    oauthClient,
    cipher,
    eventService,
    itemService,
    chainService,
    alerter,
    logger,
    getDeslocamentoMinDefault: () => 30,
  });

  const app = Fastify({ logger: false });
  registerGoogleCalendarSetupRoutes(app, service);

  return { db, app, service, logs };
}

describe('Suite S (TESTING.md §3), estendida FEAT-005: tokens do Google Calendar nunca em texto plano', () => {
  let ctx: ReturnType<typeof buildContext>;

  afterEach(() => {
    ctx.db.close();
  });

  it('access_token_encrypted e refresh_token_encrypted no SQLite nunca são o texto plano do token', async () => {
    ctx = buildContext();

    await ctx.app.inject({ method: 'GET', url: '/setup/google/callback?code=codigo-valido' });

    const row = ctx.db
      .prepare('SELECT access_token_encrypted, refresh_token_encrypted FROM auth_tokens WHERE provider = ?')
      .get('google_calendar') as { access_token_encrypted: string; refresh_token_encrypted: string };

    expect(row.access_token_encrypted).not.toBe(ACCESS_TOKEN);
    expect(row.access_token_encrypted).not.toContain(ACCESS_TOKEN);
    expect(row.refresh_token_encrypted).not.toBe(REFRESH_TOKEN);
    expect(row.refresh_token_encrypted).not.toContain(REFRESH_TOKEN);
  });

  it('não loga o access_token nem o refresh_token em nenhum nível, mesmo durante o setup', async () => {
    ctx = buildContext();

    await ctx.app.inject({ method: 'GET', url: '/setup/google/callback?code=codigo-valido' });

    const serialized = JSON.stringify(ctx.logs);
    expect(serialized).not.toContain(ACCESS_TOKEN);
    expect(serialized).not.toContain(REFRESH_TOKEN);
  });

  it('não expõe token em stdout (logger real, redact do pino) durante falha de refresh', async () => {
    ctx = buildContext();
    ctx.db.prepare(
      `INSERT INTO auth_tokens (provider, access_token_encrypted, refresh_token_encrypted, expiry, scopes) VALUES (?, ?, ?, ?, ?)`,
    ).run(
      'google_calendar',
      new TokenCipher(randomBytes(32).toString('base64')).encrypt('nao-importa'),
      new TokenCipher(randomBytes(32).toString('base64')).encrypt(REFRESH_TOKEN),
      new Date(Date.now() - 60_000).toISOString(),
      'https://www.googleapis.com/auth/calendar.events',
    );

    const { createLogger } = await import('../../src/core/logger.js');
    const realLogger = createLogger('production');
    const { GoogleCalendarService: RealService } = await import(
      '../../src/modules/integrations/google-calendar/google-calendar-service.js'
    );
    const failingOauth: GoogleOAuthPort = {
      buildConsentUrl: () => '',
      exchangeCode: vi.fn(),
      refresh: vi.fn().mockRejectedValue(new Error(`falha carregando token ${REFRESH_TOKEN}`)),
      listEventsToday: vi.fn(),
      insertEvent: vi.fn(),
    };
    const service = new RealService({
      tokensRepository: new AuthTokensRepository(ctx.db),
      oauthClient: failingOauth,
      cipher: new TokenCipher(randomBytes(32).toString('base64')),
      eventService: new EventService(new EventsRepository(ctx.db)),
      itemService: new ItemService(new ItemsRepository(ctx.db)),
      chainService: new ChainService({
        eventService: new EventService(new EventsRepository(ctx.db)),
        jobRepository: new JobRepository(ctx.db),
        getSettings: () => ({ vesperaHour: 20, manhaHour: 8, prepMarginMin: 15 }),
      }),
      alerter: { alertDeliveryExhausted: vi.fn(), alertRefreshFailure: vi.fn() },
      logger: realLogger,
      getDeslocamentoMinDefault: () => 30,
    });

    const { logs, restore } = captureStdout();
    try {
      await service.listTodayAndSync().catch(() => undefined);
    } finally {
      restore();
    }

    expect(logs.join('')).not.toContain(REFRESH_TOKEN);
  });
});
