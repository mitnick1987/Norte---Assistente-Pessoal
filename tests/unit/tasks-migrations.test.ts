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

describe('migrações do módulo tasks', () => {
  it('cria a tabela items do zero', () => {
    const db = new Database(':memory:');

    runMigrations(db, tasksMigrations);

    expect(tableNames(db)).toContain('items');
  });

  it('down reverte de forma limpa (down testado)', () => {
    const db = new Database(':memory:');
    runMigrations(db, tasksMigrations);

    for (const migration of [...tasksMigrations].reverse()) {
      expect(() => rollbackMigration(db, migration)).not.toThrow();
    }

    expect(tableNames(db)).not.toContain('items');
  });

  it('CHECK constraint rejeita status fora do vocabulário do domínio', () => {
    const db = new Database(':memory:');
    runMigrations(db, tasksMigrations);

    expect(() =>
      db
        .prepare(`INSERT INTO items (type, title, origin, status) VALUES ('tarefa', 'x', 'texto', 'invalido')`)
        .run(),
    ).toThrow();
  });

  it('CHECK constraint rejeita type fora do vocabulário do domínio', () => {
    const db = new Database(':memory:');
    runMigrations(db, tasksMigrations);

    expect(() =>
      db.prepare(`INSERT INTO items (type, title, origin) VALUES ('projeto', 'x', 'texto')`).run(),
    ).toThrow();
  });

  it('source_message_id: aceita nulo (item criado por comando, sem mensagem de origem) e valor numérico', () => {
    const db = new Database(':memory:');
    runMigrations(db, tasksMigrations);

    db.prepare(`INSERT INTO items (type, title, origin) VALUES ('tarefa', 'x', 'texto')`).run();
    db.prepare(`INSERT INTO items (type, title, origin, source_message_id) VALUES ('tarefa', 'y', 'texto', 42)`).run();

    const rows = db.prepare('SELECT source_message_id FROM items ORDER BY id').all() as {
      source_message_id: number | null;
    }[];
    expect(rows).toEqual([{ source_message_id: null }, { source_message_id: 42 }]);
  });

  it('down da migração tasks_002 remove source_message_id sem derrubar a tabela items', () => {
    const db = new Database(':memory:');
    runMigrations(db, tasksMigrations);

    const migration = tasksMigrations.find((m) => m.id === 'tasks_002_items_source_message');
    expect(migration).toBeDefined();

    rollbackMigration(db, migration!);

    const columns = db.prepare(`PRAGMA table_info(items)`).all() as { name: string }[];
    expect(columns.map((c) => c.name)).not.toContain('source_message_id');
    expect(tableNames(db)).toContain('items');
  });
});
