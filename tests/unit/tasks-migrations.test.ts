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

  it('down da migração tasks_002 remove source_message_id sem derrubar a tabela items (revertendo tasks_003 antes, dependência de índice)', () => {
    const db = new Database(':memory:');
    runMigrations(db, tasksMigrations);

    // tasks_003 cria índice sobre (source_message_id, source_item_index) —
    // reverter tasks_002 isolado quebraria esse índice; ordem inversa é a
    // única sequência de rollback válida (mesma regra do CODE_STYLE §6).
    const migration003 = tasksMigrations.find((m) => m.id === 'tasks_003_items_source_item_index');
    const migration002 = tasksMigrations.find((m) => m.id === 'tasks_002_items_source_message');
    expect(migration003).toBeDefined();
    expect(migration002).toBeDefined();

    rollbackMigration(db, migration003!);
    rollbackMigration(db, migration002!);

    const columns = db.prepare(`PRAGMA table_info(items)`).all() as { name: string }[];
    expect(columns.map((c) => c.name)).not.toContain('source_message_id');
    expect(tableNames(db)).toContain('items');
  });

  it('índice único composto (source_message_id, source_item_index) rejeita item duplicado na mesma posição', () => {
    const db = new Database(':memory:');
    runMigrations(db, tasksMigrations);

    db.prepare(
      `INSERT INTO items (type, title, origin, source_message_id, source_item_index) VALUES ('tarefa', 'a', 'texto', 5, 0)`,
    ).run();

    expect(() =>
      db
        .prepare(
          `INSERT INTO items (type, title, origin, source_message_id, source_item_index) VALUES ('tarefa', 'a-repetido', 'texto', 5, 0)`,
        )
        .run(),
    ).toThrow();
  });

  it('índice único composto permite índices diferentes da mesma mensagem e o mesmo índice sem source_message_id', () => {
    const db = new Database(':memory:');
    runMigrations(db, tasksMigrations);

    expect(() => {
      db.prepare(
        `INSERT INTO items (type, title, origin, source_message_id, source_item_index) VALUES ('tarefa', 'a', 'texto', 5, 0)`,
      ).run();
      db.prepare(
        `INSERT INTO items (type, title, origin, source_message_id, source_item_index) VALUES ('tarefa', 'b', 'texto', 5, 1)`,
      ).run();
      db.prepare(`INSERT INTO items (type, title, origin, source_item_index) VALUES ('tarefa', 'c', 'texto', 0)`).run();
      db.prepare(`INSERT INTO items (type, title, origin, source_item_index) VALUES ('tarefa', 'd', 'texto', 0)`).run();
    }).not.toThrow();
  });

  it('down da migração tasks_003 remove source_item_index sem derrubar a tabela items', () => {
    const db = new Database(':memory:');
    runMigrations(db, tasksMigrations);

    const migration = tasksMigrations.find((m) => m.id === 'tasks_003_items_source_item_index');
    expect(migration).toBeDefined();

    rollbackMigration(db, migration!);

    const columns = db.prepare(`PRAGMA table_info(items)`).all() as { name: string }[];
    expect(columns.map((c) => c.name)).not.toContain('source_item_index');
    expect(tableNames(db)).toContain('items');
  });
});
