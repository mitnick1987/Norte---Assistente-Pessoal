import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations, rollbackMigration } from '../../src/core/db/migrator.js';
import { tasksMigrations } from '../../src/modules/tasks/migrations/index.js';

function insertItem(db: Database.Database): number {
  const result = db
    .prepare(`INSERT INTO items (type, title, origin) VALUES ('compromisso', 'x', 'texto')`)
    .run();
  return Number(result.lastInsertRowid);
}

describe('migração tasks_006_events_gcal_id_unique', () => {
  it('rejeita dois events com o mesmo gcal_id (idempotência da sincronização de leitura, FEAT-005)', () => {
    const db = new Database(':memory:');
    runMigrations(db, tasksMigrations);
    const itemId = insertItem(db);

    db.prepare(
      `INSERT INTO events (item_id, title, start_at, gcal_id) VALUES (?, 'x', '2026-08-28T17:00:00.000Z', 'gcal-abc')`,
    ).run(itemId);

    expect(() =>
      db
        .prepare(
          `INSERT INTO events (item_id, title, start_at, gcal_id) VALUES (?, 'x', '2026-08-28T17:00:00.000Z', 'gcal-abc')`,
        )
        .run(itemId),
    ).toThrow();
  });

  it('permite múltiplos events com gcal_id nulo (evento nascido de captura própria, sem Google)', () => {
    const db = new Database(':memory:');
    runMigrations(db, tasksMigrations);
    const itemId = insertItem(db);

    expect(() => {
      db.prepare(`INSERT INTO events (item_id, title, start_at) VALUES (?, 'a', '2026-08-28T17:00:00.000Z')`).run(itemId);
      db.prepare(`INSERT INTO events (item_id, title, start_at) VALUES (?, 'b', '2026-08-28T18:00:00.000Z')`).run(itemId);
    }).not.toThrow();
  });

  it('down remove o índice único (down testado) sem derrubar a tabela events', () => {
    const db = new Database(':memory:');
    runMigrations(db, tasksMigrations);
    const itemId = insertItem(db);
    db.prepare(
      `INSERT INTO events (item_id, title, start_at, gcal_id) VALUES (?, 'x', '2026-08-28T17:00:00.000Z', 'gcal-abc')`,
    ).run(itemId);

    const migration = tasksMigrations.find((m) => m.id === 'tasks_006_events_gcal_id_unique');
    expect(migration).toBeDefined();
    rollbackMigration(db, migration!);

    expect(() =>
      db
        .prepare(
          `INSERT INTO events (item_id, title, start_at, gcal_id) VALUES (?, 'y', '2026-08-28T19:00:00.000Z', 'gcal-abc')`,
        )
        .run(itemId),
    ).not.toThrow();
    const count = db.prepare('SELECT COUNT(*) as c FROM events').get() as { c: number };
    expect(count.c).toBe(2);
  });
});
