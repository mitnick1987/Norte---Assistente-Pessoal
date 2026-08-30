import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations, rollbackMigration } from '../../src/core/db/migrator.js';
import { googleCalendarMigrations } from '../../src/modules/integrations/google-calendar/migrations/index.js';

function tableNames(db: Database.Database): string[] {
  return db
    .prepare<[], { name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table'`)
    .all()
    .map((r) => r.name);
}

describe('migração integrations_google_calendar_001_auth_tokens', () => {
  it('cria a tabela auth_tokens do zero', () => {
    const db = new Database(':memory:');

    runMigrations(db, googleCalendarMigrations);

    expect(tableNames(db)).toContain('auth_tokens');
  });

  it('down reverte de forma limpa (down testado)', () => {
    const db = new Database(':memory:');
    runMigrations(db, googleCalendarMigrations);

    for (const migration of [...googleCalendarMigrations].reverse()) {
      expect(() => rollbackMigration(db, migration)).not.toThrow();
    }

    expect(tableNames(db)).not.toContain('auth_tokens');
  });

  it('provider é chave primária — upsert por provider nunca duplica linha', () => {
    const db = new Database(':memory:');
    runMigrations(db, googleCalendarMigrations);

    db.prepare(
      `INSERT INTO auth_tokens (provider, access_token_encrypted, refresh_token_encrypted, expiry, scopes) VALUES ('google_calendar', 'a', 'b', '2026-09-01T00:00:00.000Z', 'scope')`,
    ).run();

    expect(() =>
      db
        .prepare(
          `INSERT INTO auth_tokens (provider, access_token_encrypted, refresh_token_encrypted, expiry, scopes) VALUES ('google_calendar', 'c', 'd', '2026-09-02T00:00:00.000Z', 'scope')`,
        )
        .run(),
    ).toThrow();
  });
});
