import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations, rollbackMigration } from '../../src/core/db/migrator.js';
import { tasksMigrations } from '../../src/modules/tasks/migrations/index.js';

function tableNames(db: Database.Database): string[] {
  return db
    .prepare<[], { name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table'`)
    .all()
    .map((r) => r.name);
}

describe('migração tasks_004_events', () => {
  it('cria a tabela events do zero', () => {
    const db = new Database(':memory:');

    runMigrations(db, tasksMigrations);

    expect(tableNames(db)).toContain('events');
  });

  it('down reverte de forma limpa (down testado)', () => {
    const db = new Database(':memory:');
    runMigrations(db, tasksMigrations);

    for (const migration of [...tasksMigrations].reverse()) {
      expect(() => rollbackMigration(db, migration)).not.toThrow();
    }

    expect(tableNames(db)).not.toContain('events');
  });

  it('down isolado da migração 004 remove só events, sem derrubar items', () => {
    const db = new Database(':memory:');
    runMigrations(db, tasksMigrations);

    const migration = tasksMigrations.find((m) => m.id === 'tasks_004_events');
    expect(migration).toBeDefined();

    rollbackMigration(db, migration!);

    expect(tableNames(db)).not.toContain('events');
    expect(tableNames(db)).toContain('items');
  });

  it('CHECK constraint rejeita status fora do vocabulário do domínio', () => {
    const db = new Database(':memory:');
    runMigrations(db, tasksMigrations);
    db.prepare(`INSERT INTO items (type, title, origin) VALUES ('compromisso', 'x', 'texto')`).run();

    expect(() =>
      db
        .prepare(
          `INSERT INTO events (item_id, title, start_at, status) VALUES (1, 'x', '2026-08-28T17:00:00.000Z', 'invalido')`,
        )
        .run(),
    ).toThrow();
  });

  it('status default é ativo, cadeia_gerada default é 0, gcal_id nulo (fonte interna, FEAT-005 ainda não existe)', () => {
    const db = new Database(':memory:');
    runMigrations(db, tasksMigrations);
    db.prepare(`INSERT INTO items (type, title, origin) VALUES ('compromisso', 'x', 'texto')`).run();

    db.prepare(`INSERT INTO events (item_id, title, start_at, deslocamento_min) VALUES (1, 'x', '2026-08-28T17:00:00.000Z', 30)`).run();

    const row = db.prepare('SELECT status, cadeia_gerada, gcal_id FROM events').get() as {
      status: string;
      cadeia_gerada: number;
      gcal_id: string | null;
    };
    expect(row).toEqual({ status: 'ativo', cadeia_gerada: 0, gcal_id: null });
  });

  it('dropar (cancelar) evento nunca remove a linha (deleção lógica, ADR-009)', () => {
    const db = new Database(':memory:');
    runMigrations(db, tasksMigrations);
    db.prepare(`INSERT INTO items (type, title, origin) VALUES ('compromisso', 'x', 'texto')`).run();
    db.prepare(`INSERT INTO events (item_id, title, start_at) VALUES (1, 'x', '2026-08-28T17:00:00.000Z')`).run();

    db.prepare(`UPDATE events SET status = 'cancelado' WHERE id = 1`).run();

    const count = db.prepare('SELECT COUNT(*) as c FROM events').get() as { c: number };
    expect(count.c).toBe(1);
    const row = db.prepare('SELECT status FROM events WHERE id = 1').get() as { status: string };
    expect(row.status).toBe('cancelado');
  });
});
