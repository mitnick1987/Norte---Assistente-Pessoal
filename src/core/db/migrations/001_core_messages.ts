import type { Migration } from '../../kernel/types.js';

/**
 * Toda mensagem in/out passa por aqui — dedup de webhook por wa_message_id
 * (a Evolution reentrega) e auditoria de custo (tokens/cache) do RF-15.
 * Datas armazenadas em UTC (ISO 8601); TZ America/Sao_Paulo é aplicado só
 * na borda de exibição/cálculo, nunca no armazenamento (CODE_STYLE §2).
 */
export const coreMessages001: Migration = {
  id: '001_core_messages',
  up(db) {
    db.exec(`
      CREATE TABLE messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
        wa_message_id TEXT,
        jid TEXT NOT NULL,
        body TEXT,
        intent TEXT,
        tokens_in INTEGER,
        tokens_out INTEGER,
        cache_read_tokens INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE UNIQUE INDEX messages_wa_message_id_dedup
        ON messages (wa_message_id)
        WHERE wa_message_id IS NOT NULL;
    `);
  },
  down(db) {
    db.exec('DROP TABLE IF EXISTS messages;');
  },
};
