import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/core/db/migrator.js';
import { googleCalendarMigrations } from '../../src/modules/integrations/google-calendar/migrations/index.js';
import { AuthTokensRepository } from '../../src/modules/integrations/google-calendar/auth-tokens-repository.js';

function buildRepository() {
  const db = new Database(':memory:');
  runMigrations(db, googleCalendarMigrations);
  return new AuthTokensRepository(db);
}

describe('AuthTokensRepository', () => {
  it('findByProvider devolve undefined quando não há token para o provider', () => {
    const repository = buildRepository();

    expect(repository.findByProvider('google_calendar')).toBeUndefined();
  });

  it('upsert grava e findByProvider lê de volta os mesmos valores', () => {
    const repository = buildRepository();

    const created = repository.upsert({
      provider: 'google_calendar',
      accessTokenEncrypted: 'access-cifrado',
      refreshTokenEncrypted: 'refresh-cifrado',
      expiry: new Date('2026-09-01T12:00:00.000Z'),
      scopes: 'https://www.googleapis.com/auth/calendar.events',
    });

    expect(created).toEqual({
      provider: 'google_calendar',
      accessTokenEncrypted: 'access-cifrado',
      refreshTokenEncrypted: 'refresh-cifrado',
      expiry: '2026-09-01T12:00:00.000Z',
      scopes: 'https://www.googleapis.com/auth/calendar.events',
      updatedAt: expect.any(String),
    });
    expect(repository.findByProvider('google_calendar')).toEqual(created);
  });

  it('upsert sobre provider existente atualiza a mesma linha (nunca duplica)', () => {
    const repository = buildRepository();
    repository.upsert({
      provider: 'google_calendar',
      accessTokenEncrypted: 'access-1',
      refreshTokenEncrypted: 'refresh-1',
      expiry: new Date('2026-09-01T12:00:00.000Z'),
      scopes: 'scope-1',
    });

    repository.upsert({
      provider: 'google_calendar',
      accessTokenEncrypted: 'access-2',
      refreshTokenEncrypted: 'refresh-2',
      expiry: new Date('2026-09-02T12:00:00.000Z'),
      scopes: 'scope-2',
    });

    const stored = repository.findByProvider('google_calendar');
    expect(stored?.accessTokenEncrypted).toBe('access-2');
    expect(stored?.refreshTokenEncrypted).toBe('refresh-2');
  });

  it('updateAccessToken atualiza só access token e expiry, preservando o refresh token', () => {
    const repository = buildRepository();
    repository.upsert({
      provider: 'google_calendar',
      accessTokenEncrypted: 'access-antigo',
      refreshTokenEncrypted: 'refresh-preservado',
      expiry: new Date('2026-09-01T12:00:00.000Z'),
      scopes: 'scope',
    });

    repository.updateAccessToken('google_calendar', 'access-renovado', new Date('2026-09-01T13:00:00.000Z'));

    const stored = repository.findByProvider('google_calendar');
    expect(stored?.accessTokenEncrypted).toBe('access-renovado');
    expect(stored?.refreshTokenEncrypted).toBe('refresh-preservado');
    expect(stored?.expiry).toBe('2026-09-01T13:00:00.000Z');
  });
});
