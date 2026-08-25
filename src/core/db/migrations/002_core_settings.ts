import type { Migration } from '../../kernel/types.js';

/**
 * Chaves tipadas com defaults declarados pelos módulos (settingsDefaults do
 * manifesto). O valor fica em texto (JSON quando composto) — o parse/tipo
 * é responsabilidade de core/settings, não do schema da tabela.
 */
export const coreSettings002: Migration = {
  id: '002_core_settings',
  up(db) {
    db.exec(`
      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  },
  down(db) {
    db.exec('DROP TABLE IF EXISTS settings;');
  },
};
