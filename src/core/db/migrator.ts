import type { Database } from 'better-sqlite3';
import type { Migration } from '../kernel/types.js';

function ensureMigrationsTable(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
}

/**
 * Aplica migrações em ordem estável (id ascendente) — a mesma ordem em
 * qualquer ambiente, independente de quais módulos estão ativos. Migração
 * já aplicada é pulada; o id é a chave de idempotência.
 */
export function runMigrations(db: Database, migrations: readonly Migration[]): void {
  ensureMigrationsTable(db);

  const applied = new Set(
    db.prepare<[], { id: string }>('SELECT id FROM _migrations').all().map((row) => row.id),
  );

  const pending = [...migrations].sort((a, b) => a.id.localeCompare(b.id));

  for (const migration of pending) {
    if (applied.has(migration.id)) continue;

    const applyAndRecord = db.transaction(() => {
      migration.up(db);
      db.prepare('INSERT INTO _migrations (id) VALUES (?)').run(migration.id);
    });
    applyAndRecord();
  }
}

/** Reversão em ordem inversa — usada em teste (down testado) e rollback manual. */
export function rollbackMigration(db: Database, migration: Migration): void {
  const revertAndRecord = db.transaction(() => {
    migration.down(db);
    db.prepare('DELETE FROM _migrations WHERE id = ?').run(migration.id);
  });
  revertAndRecord();
}
