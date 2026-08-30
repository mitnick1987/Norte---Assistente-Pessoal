import type { Migration } from '../../../core/kernel/types.js';

/**
 * ADR-018: a idempotência do reprocessamento era por mensagem inteira
 * (`existsBySourceMessageId`) — numa captura de N itens, um crash entre o
 * INSERT do item 1 e o do item 2 fazia a varredura ver "já existe item dessa
 * mensagem" e pular os itens 2..N para sempre (perda parcial permanente).
 * `source_item_index` é a posição do item dentro da extração da triagem
 * (0-based); o índice único composto com `source_message_id` deixa a
 * idempotência granular por item — o reprocessamento grava só o que falta.
 * Parcial (`WHERE source_message_id IS NOT NULL`): item sem origem de
 * mensagem (nenhum hoje, mas o contrato não exige) não entra na unicidade.
 */
export const tasksItemsSourceItemIndex003: Migration = {
  id: 'tasks_003_items_source_item_index',
  up(db) {
    db.exec(`
      ALTER TABLE items ADD COLUMN source_item_index INTEGER;
      CREATE UNIQUE INDEX items_source_message_item_unique
        ON items (source_message_id, source_item_index)
        WHERE source_message_id IS NOT NULL;
    `);
  },
  down(db) {
    db.exec(`
      DROP INDEX IF EXISTS items_source_message_item_unique;
      ALTER TABLE items DROP COLUMN source_item_index;
    `);
  },
};
