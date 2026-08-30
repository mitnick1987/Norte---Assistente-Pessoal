import type { Migration } from '../../../core/kernel/types.js';

/**
 * SQLite não tem `ALTER TABLE ... DROP CONSTRAINT` — a única forma de mudar
 * um `CHECK` é recriar a tabela (padrão documentado do próprio SQLite:
 * criar nova, copiar, dropar antiga, renomear). `origin` ganha
 * `google_calendar` (FEAT-005: item nascido da sincronização de leitura da
 * agenda externa, nunca de captura pelo próprio dono) — todo o resto do
 * schema da 001 é preservado byte a byte, inclusive os índices.
 */
export const tasksItemsOriginGoogleCalendar005: Migration = {
  id: 'tasks_005_items_origin_google_calendar',
  up(db) {
    db.exec(`
      CREATE TABLE items_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL CHECK (type IN ('tarefa', 'ideia', 'compromisso', 'lembrete', 'nota')),
        title TEXT NOT NULL,
        origin TEXT NOT NULL CHECK (origin IN ('texto', 'audio', 'foto', 'encaminhada', 'email', 'trabalho', 'google_calendar')),
        status TEXT NOT NULL DEFAULT 'inbox'
          CHECK (status IN ('inbox', 'ativa', 'em_andamento', 'feita', 'adiada', 'arquivada', 'dropada')),
        priority INTEGER CHECK (priority IN (1, 2, 3)),
        due_at TEXT,
        snooze_count INTEGER NOT NULL DEFAULT 0,
        source_message_id INTEGER,
        source_item_index INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      INSERT INTO items_new SELECT * FROM items;

      DROP TABLE items;
      ALTER TABLE items_new RENAME TO items;

      CREATE INDEX items_status_lookup ON items (status);
      CREATE INDEX items_due_at_lookup ON items (due_at);
      CREATE INDEX items_source_message_lookup ON items (source_message_id);
      CREATE UNIQUE INDEX items_source_message_item_unique ON items (source_message_id, source_item_index)
        WHERE source_message_id IS NOT NULL;
    `);
  },
  down(db) {
    db.exec(`
      CREATE TABLE items_old (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL CHECK (type IN ('tarefa', 'ideia', 'compromisso', 'lembrete', 'nota')),
        title TEXT NOT NULL,
        origin TEXT NOT NULL CHECK (origin IN ('texto', 'audio', 'foto', 'encaminhada', 'email', 'trabalho')),
        status TEXT NOT NULL DEFAULT 'inbox'
          CHECK (status IN ('inbox', 'ativa', 'em_andamento', 'feita', 'adiada', 'arquivada', 'dropada')),
        priority INTEGER CHECK (priority IN (1, 2, 3)),
        due_at TEXT,
        snooze_count INTEGER NOT NULL DEFAULT 0,
        source_message_id INTEGER,
        source_item_index INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      INSERT INTO items_old SELECT * FROM items WHERE origin != 'google_calendar';

      DROP TABLE items;
      ALTER TABLE items_old RENAME TO items;

      CREATE INDEX items_status_lookup ON items (status);
      CREATE INDEX items_due_at_lookup ON items (due_at);
      CREATE INDEX items_source_message_lookup ON items (source_message_id);
      CREATE UNIQUE INDEX items_source_message_item_unique ON items (source_message_id, source_item_index)
        WHERE source_message_id IS NOT NULL;
    `);
  },
};
