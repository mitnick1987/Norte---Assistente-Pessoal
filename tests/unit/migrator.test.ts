import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations, rollbackMigration } from '../../src/core/db/migrator.js';
import type { Migration } from '../../src/core/kernel/types.js';

function buildMigration(id: string): Migration {
  return {
    id,
    up: (db) => db.exec(`CREATE TABLE t_${id} (id INTEGER PRIMARY KEY)`),
    down: (db) => db.exec(`DROP TABLE t_${id}`),
  };
}

describe('runMigrations', () => {
  it('aplica migrações em ordem estável por id, independente da ordem de entrada', () => {
    const db = new Database(':memory:');
    const applied: string[] = [];
    const migrations: Migration[] = [
      { id: '002_b', up: (d) => { d.exec('SELECT 1'); applied.push('002_b'); }, down: () => undefined },
      { id: '001_a', up: (d) => { d.exec('SELECT 1'); applied.push('001_a'); }, down: () => undefined },
    ];

    runMigrations(db, migrations);

    expect(applied).toEqual(['001_a', '002_b']);
  });

  it('não reaplica migração já registrada em _migrations', () => {
    const db = new Database(':memory:');
    const migration = buildMigration('001_x');

    runMigrations(db, [migration]);
    runMigrations(db, [migration]);

    const count = db.prepare('SELECT COUNT(*) as c FROM _migrations WHERE id = ?').get('001_x') as { c: number };
    expect(count.c).toBe(1);
  });

  it('down reverte a migração e some da tabela de controle', () => {
    const db = new Database(':memory:');
    const migration = buildMigration('001_y');

    runMigrations(db, [migration]);
    expect(() => db.prepare('SELECT * FROM t_001_y').all()).not.toThrow();

    rollbackMigration(db, migration);

    expect(() => db.prepare('SELECT * FROM t_001_y').all()).toThrow();
    const row = db.prepare('SELECT * FROM _migrations WHERE id = ?').get('001_y');
    expect(row).toBeUndefined();
  });
});
