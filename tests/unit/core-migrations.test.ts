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

  it('migração 006 (FEAT-003) cria media_type, transcricao e message_key_json em messages', () => {
    const db = new Database(':memory:');
    runMigrations(db, coreMigrations);

    const columns = db.prepare(`PRAGMA table_info(messages)`).all() as { name: string }[];
    expect(columns.map((c) => c.name)).toEqual(
      expect.arrayContaining(['media_type', 'transcricao', 'message_key_json']),
    );
  });

  it('media_type: CHECK constraint aceita NULL e "audio", rejeita outro valor', () => {
    const db = new Database(':memory:');
    runMigrations(db, coreMigrations);

    expect(() =>
      db.prepare(`INSERT INTO messages (direction, jid, media_type) VALUES ('in', 'jid', 'audio')`).run(),
    ).not.toThrow();
    expect(() =>
      db.prepare(`INSERT INTO messages (direction, jid, media_type) VALUES ('in', 'jid', NULL)`).run(),
    ).not.toThrow();
    expect(() =>
      db.prepare(`INSERT INTO messages (direction, jid, media_type) VALUES ('in', 'jid', 'imagem')`).run(),
    ).toThrow();
  });

  it('down da migração 006 remove as três colunas sem derrubar a tabela', () => {
    const db = new Database(':memory:');
    runMigrations(db, coreMigrations);

    const migration = coreMigrations.find((m) => m.id === '006_core_messages_media');
    expect(migration).toBeDefined();

    rollbackMigration(db, migration!);

    const columns = db.prepare(`PRAGMA table_info(messages)`).all() as { name: string }[];
    expect(columns.map((c) => c.name)).not.toEqual(
      expect.arrayContaining(['media_type', 'transcricao', 'message_key_json']),
    );
    expect(tableNames(db)).toContain('messages');
  });

  it('migração 007 aceita status cancelado em jobs sem derrubar o CHECK existente', () => {
    const db = new Database(':memory:');
    runMigrations(db, coreMigrations);

    db.prepare(`INSERT INTO jobs (type, next_run_at, status) VALUES ('reminder', datetime('now'), 'cancelado')`).run();
    const row = db.prepare(`SELECT status FROM jobs WHERE status = 'cancelado'`).get() as { status: string };
    expect(row.status).toBe('cancelado');

    expect(() =>
      db.prepare(`INSERT INTO jobs (type, next_run_at, status) VALUES ('reminder', datetime('now'), 'inventado')`).run(),
    ).toThrow();
  });

  it('migração 007 preserva dados e o índice jobs_due_lookup ao recriar a tabela', () => {
    const db = new Database(':memory:');
    runMigrations(db, coreMigrations);

    db.prepare(`INSERT INTO jobs (type, next_run_at, status) VALUES ('reminder', '2026-08-28T11:00:00.000Z', 'pending')`).run();

    const row = db.prepare(`SELECT type, next_run_at, status FROM jobs`).get() as {
      type: string;
      next_run_at: string;
      status: string;
    };
    expect(row).toEqual({ type: 'reminder', next_run_at: '2026-08-28T11:00:00.000Z', status: 'pending' });

    const indexes = db.prepare(`PRAGMA index_list(jobs)`).all() as { name: string }[];
    expect(indexes.map((i) => i.name)).toContain('jobs_due_lookup');
  });

  it('migração 008 cria is_proactive em messages, default 0', () => {
    const db = new Database(':memory:');
    runMigrations(db, coreMigrations);

    db.prepare(`INSERT INTO messages (direction, jid) VALUES ('out', 'jid')`).run();
    const row = db.prepare('SELECT is_proactive FROM messages').get() as { is_proactive: number };
    expect(row.is_proactive).toBe(0);
  });

  it('is_proactive: aceita 1 explícito e rejeita valor fora de 0|1', () => {
    const db = new Database(':memory:');
    runMigrations(db, coreMigrations);

    expect(() =>
      db.prepare(`INSERT INTO messages (direction, jid, is_proactive) VALUES ('out', 'jid', 1)`).run(),
    ).not.toThrow();
    expect(() =>
      db.prepare(`INSERT INTO messages (direction, jid, is_proactive) VALUES ('out', 'jid', 2)`).run(),
    ).toThrow();
  });

  it('down da migração 008 remove is_proactive sem derrubar a tabela', () => {
    const db = new Database(':memory:');
    runMigrations(db, coreMigrations);

    const migration = coreMigrations.find((m) => m.id === '008_core_messages_proactive');
    expect(migration).toBeDefined();

    rollbackMigration(db, migration!);

    const columns = db.prepare(`PRAGMA table_info(messages)`).all() as { name: string }[];
    expect(columns.map((c) => c.name)).not.toContain('is_proactive');
    expect(tableNames(db)).toContain('messages');
  });

  it('down da migração 007 remove o status cancelado, rebaixando jobs cancelados para failed (melhor mapeamento reversível)', () => {
    const db = new Database(':memory:');
    runMigrations(db, coreMigrations);

    const id = db
      .prepare(`INSERT INTO jobs (type, next_run_at, status) VALUES ('reminder', datetime('now'), 'cancelado')`)
      .run().lastInsertRowid;

    const migration = coreMigrations.find((m) => m.id === '007_core_jobs_cancelado_status');
    expect(migration).toBeDefined();

    rollbackMigration(db, migration!);

    const row = db.prepare('SELECT status FROM jobs WHERE id = ?').get(id) as { status: string };
    expect(row.status).toBe('failed');

    expect(() =>
      db.prepare(`INSERT INTO jobs (type, next_run_at, status) VALUES ('reminder', datetime('now'), 'cancelado')`).run(),
    ).toThrow();
    expect(tableNames(db)).toContain('jobs');
  });
});
