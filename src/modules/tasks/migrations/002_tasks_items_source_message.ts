import type { Migration } from '../../../core/kernel/types.js';

/**
 * ADR-018: reprocessamento de uma mensagem `pending` (varredura no boot) não
 * pode duplicar o item que uma tentativa anterior já gravou antes de
 * crashar. `source_message_id` guarda de qual mensagem de entrada o item
 * veio — a captura consulta essa coluna antes de gravar de novo (idempotência
 * por origem, não por conteúdo). Sem FK física de propósito: `messages` é
 * tabela de `core`, `items` é de `tasks`, e módulo não referencia schema de
 * outro módulo/core via FK (ARCHITECTURE.md §2) — o vínculo é lógico,
 * validado em código.
 */
export const tasksItemsSourceMessage002: Migration = {
  id: 'tasks_002_items_source_message',
  up(db) {
    db.exec(`
      ALTER TABLE items ADD COLUMN source_message_id INTEGER;
      CREATE INDEX items_source_message_lookup ON items (source_message_id);
    `);
  },
  down(db) {
    db.exec(`
      DROP INDEX IF EXISTS items_source_message_lookup;
      ALTER TABLE items DROP COLUMN source_message_id;
    `);
  },
};
