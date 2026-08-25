import type { Database } from 'better-sqlite3';
import type { SettingsMap } from '../kernel/types.js';

/**
 * Camada fina sobre a tabela settings: valor sempre serializado como JSON
 * em texto, defaults vêm da composição dos manifestos (kernel) e só
 * preenchem o que ainda não existe no banco — nunca sobrescrevem valor já
 * setado pelo usuário/admin.
 */
export class SettingsStore {
  constructor(private readonly db: Database) {}

  seedDefaults(defaults: SettingsMap): void {
    const insertIfMissing = this.db.prepare(
      `INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`,
    );
    const seedAll = this.db.transaction((entries: [string, string | number | boolean][]) => {
      for (const [key, value] of entries) {
        insertIfMissing.run(key, JSON.stringify(value));
      }
    });
    seedAll(Object.entries(defaults));
  }

  get<T = unknown>(key: string): T | undefined {
    const row = this.db.prepare<[string], { value: string }>('SELECT value FROM settings WHERE key = ?').get(key);
    if (!row) return undefined;
    return JSON.parse(row.value) as T;
  }

  set(key: string, value: unknown): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, JSON.stringify(value));
  }
}
