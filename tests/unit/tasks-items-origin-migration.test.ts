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

function columnNames(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
}

describe('migração tasks_005_items_origin_google_calendar', () => {
  it('aceita origin "google_calendar" (FEAT-005)', () => {
    const db = new Database(':memory:');
    runMigrations(db, tasksMigrations);

    expect(() =>
      db.prepare(`INSERT INTO items (type, title, origin) VALUES ('compromisso', 'x', 'google_calendar')`).run(),
    ).not.toThrow();
  });

  it('continua rejeitando origin fora do vocabulário do domínio', () => {
    const db = new Database(':memory:');
    runMigrations(db, tasksMigrations);

    expect(() =>
      db.prepare(`INSERT INTO items (type, title, origin) VALUES ('compromisso', 'x', 'invalido')`).run(),
    ).toThrow();
  });

  it('preserva dados existentes e os índices/colunas das migrações anteriores após recriar a tabela', () => {
    const db = new Database(':memory:');
    runMigrations(db, tasksMigrations);

    db.prepare(
      `INSERT INTO items (type, title, origin, source_message_id, source_item_index) VALUES ('tarefa', 'preexistente', 'texto', 7, 0)`,
    ).run();

    const row = db.prepare('SELECT title, origin, source_message_id, source_item_index FROM items').get() as {
      title: string;
      origin: string;
      source_message_id: number;
      source_item_index: number;
    };
    expect(row).toEqual({ title: 'preexistente', origin: 'texto', source_message_id: 7, source_item_index: 0 });
    expect(columnNames(db, 'items')).toEqual(
      expect.arrayContaining(['id', 'type', 'title', 'origin', 'status', 'priority', 'due_at', 'snooze_count', 'source_message_id', 'source_item_index', 'created_at', 'updated_at']),
    );
  });

  it('migração de base já existente (upgrade) preserva cada coluna no lugar certo — não embaralha por posição', () => {
    // Reproduz o cenário real de produção: 001-004 já aplicadas (source_message_id
    // e source_item_index entraram via ALTER TABLE ADD COLUMN, que anexa ao FINAL
    // da tabela), item já capturado ANTES da 005 rodar. Se o INSERT...SELECT da 005
    // for posicional (SELECT *), a ordem declarada em items_new (que põe
    // source_message_id/source_item_index ANTES de created_at/updated_at) diverge
    // da ordem real da tabela viva e os valores trocam de coluna silenciosamente.
    const db = new Database(':memory:');
    const migrationsBefore005 = tasksMigrations.filter((m) => m.id !== 'tasks_005_items_origin_google_calendar');
    runMigrations(db, migrationsBefore005);

    db.prepare(
      `INSERT INTO items (type, title, origin, source_message_id, source_item_index, created_at, updated_at)
       VALUES ('tarefa', 'preexistente', 'texto', 42, 3, '2020-01-01T10:00:00.000Z', '2021-06-15T12:30:00.000Z')`,
    ).run();

    runMigrations(db, tasksMigrations);

    const row = db
      .prepare('SELECT source_message_id, source_item_index, created_at, updated_at FROM items')
      .get() as {
      source_message_id: number;
      source_item_index: number;
      created_at: string;
      updated_at: string;
    };
    expect(row).toEqual({
      source_message_id: 42,
      source_item_index: 3,
      created_at: '2020-01-01T10:00:00.000Z',
      updated_at: '2021-06-15T12:30:00.000Z',
    });
  });

  it('índice único composto (source_message_id, source_item_index) continua ativo após a recriação', () => {
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

  it('down remove itens com origin google_calendar e volta a rejeitar essa origem (down testado)', () => {
    const db = new Database(':memory:');
    runMigrations(db, tasksMigrations);
    db.prepare(`INSERT INTO items (type, title, origin) VALUES ('compromisso', 'sincronizado', 'google_calendar')`).run();
    db.prepare(`INSERT INTO items (type, title, origin) VALUES ('tarefa', 'proprio', 'texto')`).run();

    const migration = tasksMigrations.find((m) => m.id === 'tasks_005_items_origin_google_calendar');
    expect(migration).toBeDefined();
    rollbackMigration(db, migration!);

    expect(tableNames(db)).toContain('items');
    const remaining = db.prepare('SELECT title FROM items').all() as { title: string }[];
    expect(remaining).toEqual([{ title: 'proprio' }]);
    expect(() =>
      db.prepare(`INSERT INTO items (type, title, origin) VALUES ('compromisso', 'x', 'google_calendar')`).run(),
    ).toThrow();
  });

  it('down isolado não derruba dados de items que não vieram do Google Calendar', () => {
    const db = new Database(':memory:');
    runMigrations(db, tasksMigrations);
    db.prepare(`INSERT INTO items (type, title, origin, source_message_id) VALUES ('tarefa', 'a', 'texto', 1)`).run();

    const migration = tasksMigrations.find((m) => m.id === 'tasks_005_items_origin_google_calendar');
    rollbackMigration(db, migration!);

    const row = db.prepare('SELECT title, source_message_id FROM items').get() as {
      title: string;
      source_message_id: number;
    };
    expect(row).toEqual({ title: 'a', source_message_id: 1 });
  });
});
