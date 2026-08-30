import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations, rollbackMigration } from '../../src/core/db/migrator.js';
import { nudgesMigrations } from '../../src/modules/nudges/migrations/index.js';

function tableNames(db: Database.Database): string[] {
  return db
    .prepare<[], { name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table'`)
    .all()
    .map((r) => r.name);
}

describe('migrações do módulo nudges (RF-08, FEAT-007)', () => {
  it('cria as tabelas patterns e nudges_charges do zero', () => {
    const db = new Database(':memory:');

    runMigrations(db, nudgesMigrations);

    expect(tableNames(db)).toContain('patterns');
    expect(tableNames(db)).toContain('nudges_charges');
  });

  it('down reverte de forma limpa, na ordem inversa (down testado)', () => {
    const db = new Database(':memory:');
    runMigrations(db, nudgesMigrations);

    for (const migration of [...nudgesMigrations].reverse()) {
      expect(() => rollbackMigration(db, migration)).not.toThrow();
    }

    expect(tableNames(db)).not.toContain('patterns');
    expect(tableNames(db)).not.toContain('nudges_charges');
  });

  it('patterns aceita metrica/valor sem constraint de vocabulário fechado (schema mínimo, spec Decisões tomadas)', () => {
    const db = new Database(':memory:');
    runMigrations(db, nudgesMigrations);

    expect(() =>
      db.prepare(`INSERT INTO patterns (metrica, valor) VALUES ('janela_resposta_habitual', '{}')`).run(),
    ).not.toThrow();
  });

  it('nudges_charges grava item_id/charged_on e responded_at começa nulo', () => {
    const db = new Database(':memory:');
    runMigrations(db, nudgesMigrations);

    db.prepare(`INSERT INTO nudges_charges (item_id, charged_on) VALUES (1, '2026-08-30')`).run();

    const row = db.prepare('SELECT responded_at FROM nudges_charges WHERE item_id = 1').get() as {
      responded_at: string | null;
    };
    expect(row.responded_at).toBeNull();
  });
});
