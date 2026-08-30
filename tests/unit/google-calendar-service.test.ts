import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
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
import {
  GoogleCalendarService,
  GoogleTokenRefreshError,
} from '../../src/modules/integrations/google-calendar/google-calendar-service.js';
import { AuthTokenNotFoundError } from '../../src/modules/integrations/google-calendar/domain/index.js';
import type { GoogleOAuthPort, GoogleTokenSet } from '../../src/modules/integrations/google-calendar/google-oauth-client.js';
import type { FailureAlerter } from '../../src/core/outbox/index.js';

const FIXED_NOW = new Date('2026-09-01T13:00:00.000Z'); // terça 10h SP
const CHAIN_SETTINGS = { vesperaHour: 20, manhaHour: 8, prepMarginMin: 15 };

function randomKey(): string {
  return randomBytes(32).toString('base64');
}

function buildContext(oauthOverrides: Partial<GoogleOAuthPort> = {}) {
  const db = new Database(':memory:');
  runMigrations(db, [...coreMigrations, ...tasksMigrations, ...googleCalendarMigrations]);

  const itemService = new ItemService(new ItemsRepository(db), () => FIXED_NOW);
  const eventService = new EventService(new EventsRepository(db));
  const jobRepository = new JobRepository(db);
  const chainService = new ChainService({
    eventService,
    jobRepository,
    getSettings: () => CHAIN_SETTINGS,
    now: () => FIXED_NOW,
  });

  const tokensRepository = new AuthTokensRepository(db);
  const cipher = new TokenCipher(randomKey());

  const oauthClient: GoogleOAuthPort = {
    buildConsentUrl: vi.fn(() => 'https://accounts.google.com/consent'),
    exchangeCode: vi.fn(),
    refresh: vi.fn(),
    listEventsToday: vi.fn().mockResolvedValue([]),
    insertEvent: vi.fn(),
    ...oauthOverrides,
  };

  const alerter: FailureAlerter = {
    alertDeliveryExhausted: vi.fn(),
    alertRefreshFailure: vi.fn(),
  };

  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never;

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
    now: () => FIXED_NOW,
  });

  return { db, service, tokensRepository, cipher, oauthClient, alerter, eventService, itemService, jobRepository };
}

function validTokenSet(overrides: Partial<GoogleTokenSet> = {}): GoogleTokenSet {
  return {
    accessToken: 'access-token-valido',
    refreshToken: 'refresh-token-valido',
    expiry: new Date(FIXED_NOW.getTime() + 3_600_000),
    scopes: 'https://www.googleapis.com/auth/calendar.events',
    ...overrides,
  };
}

describe('GoogleCalendarService — setup e refresh de token (spec itens 1 e 2)', () => {
  it('completeSetup grava access/refresh token cifrados em auth_tokens', async () => {
    const { service, tokensRepository, cipher, oauthClient } = buildContext({
      exchangeCode: vi.fn().mockResolvedValue(validTokenSet()),
    });

    await service.completeSetup('codigo-de-consentimento');

    expect(oauthClient.exchangeCode).toHaveBeenCalledWith('codigo-de-consentimento');
    const stored = tokensRepository.findByProvider('google_calendar');
    expect(stored).toBeDefined();
    expect(stored!.accessTokenEncrypted).not.toContain('access-token-valido');
    expect(cipher.decrypt(stored!.accessTokenEncrypted)).toBe('access-token-valido');
    expect(cipher.decrypt(stored!.refreshTokenEncrypted)).toBe('refresh-token-valido');
  });

  it('completeSetup falha quando o Google não devolve refresh_token (reautorização sem prompt=consent efetivo)', async () => {
    const { service } = buildContext({
      exchangeCode: vi.fn().mockResolvedValue(validTokenSet({ refreshToken: undefined })),
    });

    await expect(service.completeSetup('codigo')).rejects.toThrow(/refresh_token/);
  });

  it('token ainda válido não dispara refresh desnecessário', async () => {
    const { service, tokensRepository, cipher, oauthClient } = buildContext();
    tokensRepository.upsert({
      provider: 'google_calendar',
      accessTokenEncrypted: cipher.encrypt('access-ainda-valido'),
      refreshTokenEncrypted: cipher.encrypt('refresh-token'),
      expiry: new Date(FIXED_NOW.getTime() + 3_600_000),
      scopes: 'https://www.googleapis.com/auth/calendar.events',
    });

    await service.listTodayAndSync();

    expect(oauthClient.refresh).not.toHaveBeenCalled();
    expect(oauthClient.listEventsToday).toHaveBeenCalledWith('access-ainda-valido', expect.any(Date), expect.any(Date));
  });

  it('token vencido dispara refresh antes de qualquer chamada à API do Calendar', async () => {
    const { service, tokensRepository, cipher, oauthClient } = buildContext({
      refresh: vi.fn().mockResolvedValue(
        validTokenSet({ accessToken: 'access-renovado', expiry: new Date(FIXED_NOW.getTime() + 3_600_000) }),
      ),
    });
    tokensRepository.upsert({
      provider: 'google_calendar',
      accessTokenEncrypted: cipher.encrypt('access-vencido'),
      refreshTokenEncrypted: cipher.encrypt('refresh-token-valido'),
      expiry: new Date(FIXED_NOW.getTime() - 60_000),
      scopes: 'https://www.googleapis.com/auth/calendar.events',
    });

    await service.listTodayAndSync();

    expect(oauthClient.refresh).toHaveBeenCalledWith('refresh-token-valido');
    expect(oauthClient.listEventsToday).toHaveBeenCalledWith('access-renovado', expect.any(Date), expect.any(Date));

    const updated = tokensRepository.findByProvider('google_calendar');
    expect(cipher.decrypt(updated!.accessTokenEncrypted)).toBe('access-renovado');
  });

  it('token a poucos minutos de vencer também dispara refresh (margem de segurança)', async () => {
    const { service, tokensRepository, cipher, oauthClient } = buildContext({
      refresh: vi.fn().mockResolvedValue(validTokenSet({ accessToken: 'access-renovado' })),
    });
    tokensRepository.upsert({
      provider: 'google_calendar',
      accessTokenEncrypted: cipher.encrypt('access-quase-vencendo'),
      refreshTokenEncrypted: cipher.encrypt('refresh-token-valido'),
      expiry: new Date(FIXED_NOW.getTime() + 60_000), // 1 min — dentro da margem de 5 min
      scopes: 'https://www.googleapis.com/auth/calendar.events',
    });

    await service.listTodayAndSync();

    expect(oauthClient.refresh).toHaveBeenCalled();
  });

  it('refresh falho propaga o erro e dispara alerta por e-mail — nunca mascara como sucesso silencioso', async () => {
    const refreshError = new Error('invalid_grant: token revogado');
    const { service, tokensRepository, cipher, alerter } = buildContext({
      refresh: vi.fn().mockRejectedValue(refreshError),
    });
    tokensRepository.upsert({
      provider: 'google_calendar',
      accessTokenEncrypted: cipher.encrypt('access-vencido'),
      refreshTokenEncrypted: cipher.encrypt('refresh-token-revogado'),
      expiry: new Date(FIXED_NOW.getTime() - 60_000),
      scopes: 'https://www.googleapis.com/auth/calendar.events',
    });

    await expect(service.listTodayAndSync()).rejects.toThrow(GoogleTokenRefreshError);
    expect(alerter.alertRefreshFailure).toHaveBeenCalledWith({ provider: 'google_calendar', err: refreshError });
  });

  it('sem token armazenado, lança erro claro em vez de chamar a API com credencial vazia', async () => {
    const { service } = buildContext();

    await expect(service.listTodayAndSync()).rejects.toThrow(AuthTokenNotFoundError);
  });
});

describe('GoogleCalendarService — createRemoteEvent (spec item 4, ADR-019 opção A)', () => {
  it('token válido: insere o evento no Google e devolve o gcalId', async () => {
    const { service, tokensRepository, cipher, oauthClient } = buildContext({
      insertEvent: vi.fn().mockResolvedValue({
        gcalId: 'gcal-novo',
        title: 'Dentista',
        start: { dateTime: '2026-09-04T16:00:00-03:00' },
        end: { dateTime: '2026-09-04T17:00:00-03:00' },
      }),
    });
    tokensRepository.upsert({
      provider: 'google_calendar',
      accessTokenEncrypted: cipher.encrypt('access-token'),
      refreshTokenEncrypted: cipher.encrypt('refresh-token'),
      expiry: new Date(FIXED_NOW.getTime() + 3_600_000),
      scopes: 'https://www.googleapis.com/auth/calendar.events',
    });

    const result = await service.createRemoteEvent({
      title: 'Dentista',
      startAt: new Date('2026-09-04T19:00:00.000Z'),
      endAt: new Date('2026-09-04T20:00:00.000Z'),
    });

    expect(result).toEqual({ gcalId: 'gcal-novo' });
    expect(oauthClient.insertEvent).toHaveBeenCalledWith(
      'access-token',
      expect.objectContaining({ title: 'Dentista' }),
    );
  });

  it('token vencido renova antes de inserir o evento (mesmo caminho único de refresh da leitura)', async () => {
    const { service, tokensRepository, cipher, oauthClient } = buildContext({
      refresh: vi.fn().mockResolvedValue(validTokenSet({ accessToken: 'access-renovado' })),
      insertEvent: vi.fn().mockResolvedValue({
        gcalId: 'gcal-novo',
        title: 'Reunião',
        start: { dateTime: '2026-09-04T10:00:00-03:00' },
        end: { dateTime: '2026-09-04T11:00:00-03:00' },
      }),
    });
    tokensRepository.upsert({
      provider: 'google_calendar',
      accessTokenEncrypted: cipher.encrypt('access-vencido'),
      refreshTokenEncrypted: cipher.encrypt('refresh-token-valido'),
      expiry: new Date(FIXED_NOW.getTime() - 60_000),
      scopes: 'https://www.googleapis.com/auth/calendar.events',
    });

    await service.createRemoteEvent({
      title: 'Reunião',
      startAt: new Date('2026-09-04T13:00:00.000Z'),
      endAt: new Date('2026-09-04T14:00:00.000Z'),
    });

    expect(oauthClient.refresh).toHaveBeenCalled();
    expect(oauthClient.insertEvent).toHaveBeenCalledWith('access-renovado', expect.anything());
  });

  it('sem token armazenado, propaga AuthTokenNotFoundError sem tentar inserir no Google', async () => {
    const { service, oauthClient } = buildContext();

    await expect(
      service.createRemoteEvent({
        title: 'Dentista',
        startAt: new Date('2026-09-04T19:00:00.000Z'),
        endAt: new Date('2026-09-04T20:00:00.000Z'),
      }),
    ).rejects.toThrow(AuthTokenNotFoundError);
    expect(oauthClient.insertEvent).not.toHaveBeenCalled();
  });
});

describe('GoogleCalendarService — sincronização mínima com cadeias (spec item 3)', () => {
  it('evento do Calendar com horário e sem event interno correspondente gera item + event + cadeia completa', async () => {
    const { service, tokensRepository, cipher, eventService, jobRepository } = buildContext({
      listEventsToday: vi.fn().mockResolvedValue([
        {
          gcalId: 'gcal-abc',
          title: 'Dentista',
          start: { dateTime: '2026-09-04T16:00:00-03:00' },
          end: { dateTime: '2026-09-04T17:00:00-03:00' },
        },
      ]),
    });
    tokensRepository.upsert({
      provider: 'google_calendar',
      accessTokenEncrypted: cipher.encrypt('access-token'),
      refreshTokenEncrypted: cipher.encrypt('refresh-token'),
      expiry: new Date(FIXED_NOW.getTime() + 3_600_000),
      scopes: 'https://www.googleapis.com/auth/calendar.events',
    });

    const summaries = await service.listTodayAndSync();

    expect(summaries).toHaveLength(1);
    const event = eventService.findByGcalId('gcal-abc');
    expect(event).toBeDefined();
    expect(event!.cadeiaGerada).toBe(true);
    expect(event!.deslocamentoMin).toBe(30);
    expect(jobRepository.findPending().filter((j) => j.type === 'reminder')).not.toHaveLength(0);
  });

  it('evento já sincronizado (mesmo gcalId) não duplica event nem cadeia numa segunda leitura', async () => {
    const { service, tokensRepository, cipher, eventService, jobRepository } = buildContext({
      listEventsToday: vi.fn().mockResolvedValue([
        {
          gcalId: 'gcal-repetido',
          title: 'Reunião',
          start: { dateTime: '2026-09-04T10:00:00-03:00' },
          end: { dateTime: '2026-09-04T11:00:00-03:00' },
        },
      ]),
    });
    tokensRepository.upsert({
      provider: 'google_calendar',
      accessTokenEncrypted: cipher.encrypt('access-token'),
      refreshTokenEncrypted: cipher.encrypt('refresh-token'),
      expiry: new Date(FIXED_NOW.getTime() + 3_600_000),
      scopes: 'https://www.googleapis.com/auth/calendar.events',
    });

    await service.listTodayAndSync();
    await service.listTodayAndSync();

    const events = eventService.findByGcalId('gcal-repetido');
    expect(events).toBeDefined();
    const allPendingReminders = jobRepository.findPending().filter((j) => j.type === 'reminder');
    expect(allPendingReminders).toHaveLength(3);
  });

  it('evento do Google sem horário (dia inteiro) não gera event interno nem cadeia', async () => {
    const { service, tokensRepository, cipher, eventService, jobRepository } = buildContext({
      listEventsToday: vi.fn().mockResolvedValue([
        {
          gcalId: 'gcal-feriado',
          title: 'Feriado nacional',
          start: { date: '2026-09-07' },
          end: { date: '2026-09-08' },
        },
      ]),
    });
    tokensRepository.upsert({
      provider: 'google_calendar',
      accessTokenEncrypted: cipher.encrypt('access-token'),
      refreshTokenEncrypted: cipher.encrypt('refresh-token'),
      expiry: new Date(FIXED_NOW.getTime() + 3_600_000),
      scopes: 'https://www.googleapis.com/auth/calendar.events',
    });

    await service.listTodayAndSync();

    expect(eventService.findByGcalId('gcal-feriado')).toBeUndefined();
    expect(jobRepository.findPending()).toHaveLength(0);
  });
});
