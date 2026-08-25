import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations, rollbackMigration } from '../../src/core/db/migrator.js';
import { coreMigrations } from '../../src/core/db/migrations/index.js';

function tableNames(db: Database.Database): string[] {
  return db
    .prepare<[], { name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table'`)
    .all()
    .map((r) => r.name);
}

describe('migrações base do core', () => {
  it('cria messages, settings, jobs e outbox_messages do zero', () => {
    const db = new Database(':memory:');

    runMigrations(db, coreMigrations);

    const names = tableNames(db);
    expect(names).toEqual(expect.arrayContaining(['messages', 'settings', 'jobs', 'outbox_messages']));
  });

  it('cada migração reverte de forma limpa (down testado)', () => {
    const db = new Database(':memory:');
    runMigrations(db, coreMigrations);

    for (const migration of [...coreMigrations].reverse()) {
      expect(() => rollbackMigration(db, migration)).not.toThrow();
    }

    const names = tableNames(db);
    expect(names).not.toEqual(expect.arrayContaining(['messages', 'settings', 'jobs', 'outbox_messages']));
  });

  it('índice único de dedup em wa_message_id rejeita reentrega do mesmo id', () => {
    const db = new Database(':memory:');
    runMigrations(db, coreMigrations);

    db.prepare(`INSERT INTO messages (direction, wa_message_id, jid) VALUES ('in', 'wa-1', 'jid')`).run();

    expect(() =>
      db.prepare(`INSERT INTO messages (direction, wa_message_id, jid) VALUES ('in', 'wa-1', 'jid')`).run(),
    ).toThrow(/UNIQUE constraint failed/);
  });

  it('permite múltiplas mensagens com wa_message_id nulo (ex.: saída sem correlação)', () => {
    const db = new Database(':memory:');
    runMigrations(db, coreMigrations);

    db.prepare(`INSERT INTO messages (direction, jid) VALUES ('out', 'jid')`).run();
    expect(() => db.prepare(`INSERT INTO messages (direction, jid) VALUES ('out', 'jid')`).run()).not.toThrow();
  });

  it('processing_status: mensagem out nasce processed por default, sem precisar declarar (ADR-018)', () => {
    const db = new Database(':memory:');
    runMigrations(db, coreMigrations);

    db.prepare(`INSERT INTO messages (direction, jid) VALUES ('out', 'jid')`).run();
    const row = db.prepare('SELECT processing_status FROM messages').get() as { processing_status: string };
    expect(row.processing_status).toBe('processed');
  });

  it('processing_status: CHECK constraint rejeita valor fora do vocabulário pending|processed|failed', () => {
    const db = new Database(':memory:');
    runMigrations(db, coreMigrations);

    expect(() =>
      db
        .prepare(`INSERT INTO messages (direction, jid, processing_status) VALUES ('in', 'jid', 'inventado')`)
        .run(),
    ).toThrow();
  });

  it('down da migração 005 remove a coluna processing_status sem derrubar a tabela', () => {
    const db = new Database(':memory:');
    runMigrations(db, coreMigrations);

    const migration = coreMigrations.find((m) => m.id === '005_core_messages_processing_status');
    expect(migration).toBeDefined();

    rollbackMigration(db, migration!);

    const columns = db.prepare(`PRAGMA table_info(messages)`).all() as { name: string }[];
    expect(columns.map((c) => c.name)).not.toContain('processing_status');
    expect(tableNames(db)).toContain('messages');
  });
});
