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
  InvalidOAuthStateError,
  InvalidEventDateError,
} from '../../src/modules/integrations/google-calendar/google-calendar-service.js';
import { AuthTokenNotFoundError } from '../../src/modules/integrations/google-calendar/domain/index.js';
import type { GoogleOAuthPort, GoogleTokenSet } from '../../src/modules/integrations/google-calendar/google-oauth-client.js';
import { buildAlerterStub } from '../factories/alerter-stub.js';

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
    buildConsentUrl: vi.fn((state: string) => `https://accounts.google.com/consent?state=${state}`),
    exchangeCode: vi.fn(),
    refresh: vi.fn(),
    listEventsToday: vi.fn().mockResolvedValue([]),
    insertEvent: vi.fn(),
    ...oauthOverrides,
  };

  const alerter = buildAlerterStub();

  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never;

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
    now: () => FIXED_NOW,
  });

  return { db, service, tokensRepository, cipher, oauthClient, alerter, eventService, itemService, jobRepository, chainService };
}

/** Extrai o `state` real gerado por `buildConsentUrl` — o teste nunca deve inventar um valor, senão não exercita a validação de verdade. */
function stateFromConsentUrl(url: string): string {
  const state = new URL(url).searchParams.get('state');
  if (!state) throw new Error('buildConsentUrl não gerou state — stub desatualizado');
  return state;
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

    const state = stateFromConsentUrl(service.buildConsentUrl());
    await service.completeSetup('codigo-de-consentimento', state);

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

    const state = stateFromConsentUrl(service.buildConsentUrl());
    await expect(service.completeSetup('codigo', state)).rejects.toThrow(/refresh_token/);
  });

  it('completeSetup rejeita callback sem state, sem sequer chamar exchangeCode', async () => {
    const { service, oauthClient } = buildContext({
      exchangeCode: vi.fn().mockResolvedValue(validTokenSet()),
    });
    service.buildConsentUrl();

    await expect(service.completeSetup('codigo', undefined)).rejects.toThrow(InvalidOAuthStateError);
    expect(oauthClient.exchangeCode).not.toHaveBeenCalled();
  });

  it('completeSetup rejeita callback com state divergente do gerado (CSRF/injeção de código)', async () => {
    const { service, oauthClient } = buildContext({
      exchangeCode: vi.fn().mockResolvedValue(validTokenSet()),
    });
    service.buildConsentUrl();

    await expect(service.completeSetup('codigo', 'state-forjado-pelo-atacante')).rejects.toThrow(InvalidOAuthStateError);
    expect(oauthClient.exchangeCode).not.toHaveBeenCalled();
  });

  it('completeSetup rejeita callback sem nenhum setup em andamento (nenhum buildConsentUrl chamado antes)', async () => {
    const { service, oauthClient } = buildContext({
      exchangeCode: vi.fn().mockResolvedValue(validTokenSet()),
    });

    await expect(service.completeSetup('codigo', 'qualquer-state')).rejects.toThrow(InvalidOAuthStateError);
    expect(oauthClient.exchangeCode).not.toHaveBeenCalled();
  });

  it('state é de uso único: segundo callback com o mesmo state (replay) é rejeitado', async () => {
    const { service, oauthClient } = buildContext({
      exchangeCode: vi.fn().mockResolvedValue(validTokenSet()),
    });
    const state = stateFromConsentUrl(service.buildConsentUrl());

    await service.completeSetup('codigo-original', state);
    (oauthClient.exchangeCode as ReturnType<typeof vi.fn>).mockClear();

    await expect(service.completeSetup('codigo-replay', state)).rejects.toThrow(InvalidOAuthStateError);
    expect(oauthClient.exchangeCode).not.toHaveBeenCalled();
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

  it('rodar o sync duas vezes com o mesmo evento do Google não duplica item nem event na tabela (não só o lookup)', async () => {
    const { db, service, tokensRepository, cipher } = buildContext({
      listEventsToday: vi.fn().mockResolvedValue([
        {
          gcalId: 'gcal-duplo',
          title: 'Reunião recorrente',
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
    await service.listTodayAndSync();

    const eventRows = db.prepare(`SELECT COUNT(*) as c FROM events WHERE gcal_id = 'gcal-duplo'`).get() as { c: number };
    const itemRows = db.prepare(`SELECT COUNT(*) as c FROM items WHERE origin = 'google_calendar'`).get() as { c: number };
    expect(eventRows.c).toBe(1);
    expect(itemRows.c).toBe(1);
  });

  it('falha no meio da sincronização (item+event+cadeia) desfaz tudo — nunca deixa item sem event', async () => {
    const { db, service, tokensRepository, cipher, chainService } = buildContext({
      listEventsToday: vi.fn().mockResolvedValue([
        {
          gcalId: 'gcal-crash',
          title: 'Reunião instável',
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
    vi.spyOn(chainService, 'scheduleForEvent').mockImplementation(() => {
      throw new Error('falha simulada na expansão da cadeia');
    });

    // a falha real nunca é mascarada (mesmo princípio do refresh de token) —
    // o que este teste garante é que ela não deixa estado parcial gravado.
    await expect(service.listTodayAndSync()).rejects.toThrow('falha simulada na expansão da cadeia');

    const eventRows = db.prepare(`SELECT COUNT(*) as c FROM events WHERE gcal_id = 'gcal-crash'`).get() as { c: number };
    const itemRows = db.prepare(`SELECT COUNT(*) as c FROM items WHERE origin = 'google_calendar'`).get() as { c: number };
    expect(eventRows.c).toBe(0);
    expect(itemRows.c).toBe(0);
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

describe('GoogleCalendarService — createEventFromBrain (tool create_event, FEAT-006)', () => {
  function upsertValidToken(tokensRepository: ReturnType<typeof buildContext>['tokensRepository'], cipher: ReturnType<typeof buildContext>['cipher']): void {
    tokensRepository.upsert({
      provider: 'google_calendar',
      accessTokenEncrypted: cipher.encrypt('access-token'),
      refreshTokenEncrypted: cipher.encrypt('refresh-token'),
      expiry: new Date(FIXED_NOW.getTime() + 3_600_000),
      scopes: 'https://www.googleapis.com/auth/calendar.events',
    });
  }

  it('input válido cria evento remoto + item/event interno + cadeia numa única operação', async () => {
    const ctx = buildContext({
      insertEvent: vi.fn().mockResolvedValue({
        gcalId: 'gcal-brain-1',
        title: 'Reunião com cliente',
        start: { dateTime: '2026-09-04T10:00:00-03:00' },
        end: { dateTime: '2026-09-04T11:00:00-03:00' },
      }),
    });
    upsertValidToken(ctx.tokensRepository, ctx.cipher);

    const result = await ctx.service.createEventFromBrain({
      title: 'Reunião com cliente',
      startAt: new Date('2026-09-04T13:00:00.000Z'),
      endAt: new Date('2026-09-04T14:00:00.000Z'),
      sourceMessageId: 1,
    });

    expect(result.gcalId).toBe('gcal-brain-1');
    const item = ctx.itemService.list({ includeInbox: true }).find((i) => i.id === result.itemId);
    expect(item).toBeDefined();
    expect(item!.type).toBe('compromisso');

    const event = ctx.eventService.findActiveByItemId(result.itemId);
    expect(event).toBeDefined();
    expect(event!.gcalId).toBe('gcal-brain-1');

    // cadeia gerada (véspera/manhã/preparo) — mesma sequência que `syncEvent` já garante.
    expect(ctx.jobRepository.findPending().length).toBeGreaterThan(0);
  });

  it('reprocessar a mesma mensagem de conversa (varredura de recuperação do boot) nunca cria um segundo evento no Google', async () => {
    // Cada chamada real ao Google cria um evento NOVO com um gcalId próprio
    // (diferente da reentrega idempotente do lado do Google testada acima) —
    // é exatamente esse cenário que expõe o bug sem a checagem de
    // `sourceMessageId`: duas chamadas a `createEventFromBrain` sem
    // idempotência própria geram dois eventos reais distintos.
    let callCount = 0;
    const insertEvent = vi.fn().mockImplementation(async () => {
      callCount++;
      return {
        gcalId: `gcal-brain-reproc-${callCount}`,
        title: 'Dentista',
        start: { dateTime: '2026-09-04T10:00:00-03:00' },
        end: { dateTime: '2026-09-04T11:00:00-03:00' },
      };
    });
    const ctx = buildContext({ insertEvent });
    upsertValidToken(ctx.tokensRepository, ctx.cipher);

    const params = {
      title: 'Dentista',
      startAt: new Date('2026-09-04T13:00:00.000Z'),
      endAt: new Date('2026-09-04T14:00:00.000Z'),
      sourceMessageId: 77,
    };

    const first = await ctx.service.createEventFromBrain(params);
    const second = await ctx.service.createEventFromBrain(params);

    expect(insertEvent).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);

    const itemsCount = ctx.db.prepare(`SELECT COUNT(*) as c FROM items WHERE type = 'compromisso'`).get() as {
      c: number;
    };
    expect(itemsCount.c).toBe(1);
  });

  it('endAt ausente aplica duração default de 1h', async () => {
    const insertEvent = vi.fn().mockResolvedValue({
      gcalId: 'gcal-brain-2',
      title: 'Call rápida',
      start: { dateTime: '2026-09-04T10:00:00-03:00' },
      end: { dateTime: '2026-09-04T11:00:00-03:00' },
    });
    const ctx = buildContext({ insertEvent });
    upsertValidToken(ctx.tokensRepository, ctx.cipher);

    await ctx.service.createEventFromBrain({
      title: 'Call rápida',
      startAt: new Date('2026-09-04T13:00:00.000Z'),
      endAt: new Date('2026-09-04T14:00:00.000Z'),
      sourceMessageId: 1,
    });

    expect(insertEvent).toHaveBeenCalledWith(
      'access-token',
      expect.objectContaining({ startAt: new Date('2026-09-04T13:00:00.000Z'), endAt: new Date('2026-09-04T14:00:00.000Z') }),
    );
  });

  it('data no passado distante é rejeitada antes de chamar o Google', async () => {
    const ctx = buildContext();
    upsertValidToken(ctx.tokensRepository, ctx.cipher);

    await expect(
      ctx.service.createEventFromBrain({
        title: 'Evento suspeito',
        startAt: new Date('2020-01-01T13:00:00.000Z'),
        endAt: new Date('2020-01-01T14:00:00.000Z'),
        sourceMessageId: 1,
      }),
    ).rejects.toThrow(InvalidEventDateError);
    expect(ctx.oauthClient.insertEvent).not.toHaveBeenCalled();
  });

  it('ano absurdamente no futuro é rejeitado antes de chamar o Google', async () => {
    const ctx = buildContext();
    upsertValidToken(ctx.tokensRepository, ctx.cipher);

    await expect(
      ctx.service.createEventFromBrain({
        title: 'Evento distante demais',
        startAt: new Date('2099-01-01T13:00:00.000Z'),
        endAt: new Date('2099-01-01T14:00:00.000Z'),
        sourceMessageId: 1,
      }),
    ).rejects.toThrow(InvalidEventDateError);
    expect(ctx.oauthClient.insertEvent).not.toHaveBeenCalled();
  });

  it('endAt antes ou igual a startAt é rejeitado', async () => {
    const ctx = buildContext();
    upsertValidToken(ctx.tokensRepository, ctx.cipher);

    await expect(
      ctx.service.createEventFromBrain({
        title: 'Evento invertido',
        startAt: new Date('2026-09-04T14:00:00.000Z'),
        endAt: new Date('2026-09-04T13:00:00.000Z'),
        sourceMessageId: 1,
      }),
    ).rejects.toThrow(InvalidEventDateError);
  });

  it('sem token armazenado, propaga AuthTokenNotFoundError sem gravar item/event órfão', async () => {
    const ctx = buildContext();

    await expect(
      ctx.service.createEventFromBrain({
        title: 'Reunião',
        startAt: new Date('2026-09-04T13:00:00.000Z'),
        endAt: new Date('2026-09-04T14:00:00.000Z'),
        sourceMessageId: 1,
      }),
    ).rejects.toThrow(AuthTokenNotFoundError);

    expect(ctx.itemService.list({ includeInbox: true })).toHaveLength(0);
  });
});
