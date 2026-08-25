import type { Migration } from '../../kernel/types.js';

/**
 * Fila de envio do outbox. Separada de `jobs`: um job pode gerar zero, uma
 * ou várias mensagens de saída (ex.: revisão noturna manda até 3), e o
 * outbox precisa do próprio ciclo de retry independente do job que a
 * originou. `job_id` é opcional — comandos determinísticos (RF-07) também
 * enfileiram aqui sem vir de um job agendado.
 */
export const coreOutboxMessages004: Migration = {
  id: '004_core_outbox_messages',
  up(db) {
    db.exec(`
      CREATE TABLE outbox_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id INTEGER REFERENCES jobs(id),
        jid TEXT NOT NULL,
        body TEXT NOT NULL,
        is_proactive INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'sending', 'delivered', 'failed')),
        attempts INTEGER NOT NULL DEFAULT 0,
        delivered_at TEXT,
        retry_after TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX outbox_messages_pending_lookup ON outbox_messages (status);
    `);
  },
  down(db) {
    db.exec('DROP TABLE IF EXISTS outbox_messages;');
  },
};
