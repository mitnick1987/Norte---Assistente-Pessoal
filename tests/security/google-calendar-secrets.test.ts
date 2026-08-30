import { randomBytes } from 'node:crypto';
import { Writable } from 'node:stream';
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

/**
 * Sobrescrever `process.stdout.write` não captura nada aqui: o destino
 * padrão do pino escreve no fd 1 via sonic-boom, por baixo do override JS
 * (fdget dele é o fd real, não o stream do Node). `createLogger` aceita um
 * `Writable` injetável exatamente para este caso — é a única forma de
 * capturar a saída real do serializer/redact de produção neste teste.
 */
function captureLoggerOutput(): { chunks: string[]; destination: Writable } {
  const chunks: string[] = [];
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  return { chunks, destination };
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
    buildConsentUrl: vi.fn((state: string) => `https://accounts.google.com/consent?state=${state}`),
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

  const alerter: FailureAlerter = { alertDeliveryExhausted: vi.fn(), alertRefreshFailure: vi.fn(), alertAnchorRitualCapped: vi.fn() };

  const logs: unknown[] = [];
  const logger = {
    info: (obj: unknown) => logs.push(obj),
    warn: (obj: unknown) => logs.push(obj),
    error: (obj: unknown) => logs.push(obj),
  } as never;

  const cipher = new TokenCipher(randomBytes(32).toString('base64'));
  const tokensRepository = new AuthTokensRepository(db);

  const service = new GoogleCalendarService({
    db,
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

/** Simula o fluxo real de duas chamadas: GET /setup/google gera o state, o callback precisa devolvê-lo. */
async function fetchValidState(app: ReturnType<typeof buildContext>['app']): Promise<string> {
  const consent = await app.inject({ method: 'GET', url: '/setup/google' });
  const state = new URL(consent.headers.location as string).searchParams.get('state');
  if (!state) throw new Error('setup não gerou state — stub desatualizado');
  return state;
}

describe('Suite S (TESTING.md §3), estendida FEAT-005: tokens do Google Calendar nunca em texto plano', () => {
  let ctx: ReturnType<typeof buildContext>;

  afterEach(() => {
    ctx.db.close();
  });

  it('access_token_encrypted e refresh_token_encrypted no SQLite nunca são o texto plano do token', async () => {
    ctx = buildContext();
    const state = await fetchValidState(ctx.app);

    await ctx.app.inject({ method: 'GET', url: `/setup/google/callback?code=codigo-valido&state=${state}` });

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
    const state = await fetchValidState(ctx.app);

    await ctx.app.inject({ method: 'GET', url: `/setup/google/callback?code=codigo-valido&state=${state}` });

    const serialized = JSON.stringify(ctx.logs);
    expect(serialized).not.toContain(ACCESS_TOKEN);
    expect(serialized).not.toContain(REFRESH_TOKEN);
  });

  it('não expõe refresh_token/client_secret em log (logger real, redact do pino) durante falha de refresh', async () => {
    ctx = buildContext();
    const CLIENT_SECRET = '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-sqlite';
    // mesma chave para gravar e para o serviço: com chaves diferentes o
    // decrypt falha ANTES de chamar oauthClient.refresh() e o teste vira
    // vacuoso (a linha que loga o erro de refresh nunca é alcançada).
    const cipher = new TokenCipher(randomBytes(32).toString('base64'));
    ctx.db.prepare(
      `INSERT INTO auth_tokens (provider, access_token_encrypted, refresh_token_encrypted, expiry, scopes) VALUES (?, ?, ?, ?, ?)`,
    ).run(
      'google_calendar',
      cipher.encrypt('nao-importa'),
      cipher.encrypt(REFRESH_TOKEN),
      new Date(Date.now() - 60_000).toISOString(),
      'https://www.googleapis.com/auth/calendar.events',
    );

    const { createLogger } = await import('../../src/core/logger.js');
    const { chunks, destination } = captureLoggerOutput();
    const realLogger = createLogger('production', destination);
    const { GoogleCalendarService: RealService } = await import(
      '../../src/modules/integrations/google-calendar/google-calendar-service.js'
    );
    // Shape real de um erro gaxios de refresh (invalid_grant): o segredo não
    // fica em err.message, e sim no corpo x-www-form-urlencoded da requisição
    // (err.config.data) e no header Authorization — é por aí que o vazamento
    // do achado bloqueante acontece, não pela mensagem simples.
    const gaxiosLikeRefreshError = Object.assign(new Error('invalid_grant'), {
      config: {
        data: `client_secret=${CLIENT_SECRET}&refresh_token=${REFRESH_TOKEN}&grant_type=refresh_token`,
        headers: { authorization: `Bearer ${REFRESH_TOKEN}` },
      },
      response: { data: { error: 'invalid_grant' } },
    });
    const failingOauth: GoogleOAuthPort = {
      buildConsentUrl: () => '',
      exchangeCode: vi.fn(),
      refresh: vi.fn().mockRejectedValue(gaxiosLikeRefreshError),
      listEventsToday: vi.fn(),
      insertEvent: vi.fn(),
    };
    const service = new RealService({
      db: ctx.db,
      tokensRepository: new AuthTokensRepository(ctx.db),
      oauthClient: failingOauth,
      cipher,
      eventService: new EventService(new EventsRepository(ctx.db)),
      itemService: new ItemService(new ItemsRepository(ctx.db)),
      chainService: new ChainService({
        eventService: new EventService(new EventsRepository(ctx.db)),
        jobRepository: new JobRepository(ctx.db),
        getSettings: () => ({ vesperaHour: 20, manhaHour: 8, prepMarginMin: 15 }),
      }),
      alerter: { alertDeliveryExhausted: vi.fn(), alertRefreshFailure: vi.fn(), alertAnchorRitualCapped: vi.fn() },
      logger: realLogger,
      getDeslocamentoMinDefault: () => 30,
    });

    // prova que o caminho real (refresh) foi de fato alcançado — sem isso o
    // teste passaria vacuamente mesmo que o decrypt tivesse falhado antes.
    await service.listTodayAndSync().catch(() => undefined);
    expect(failingOauth.refresh).toHaveBeenCalledWith(REFRESH_TOKEN);

    const output = chunks.join('');
    expect(output).not.toContain(REFRESH_TOKEN);
    expect(output).not.toContain(CLIENT_SECRET);
  });
});
