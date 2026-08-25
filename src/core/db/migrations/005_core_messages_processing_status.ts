import type { Migration } from '../../kernel/types.js';

/**
 * ADR-018: o webhook grava a mensagem de entrada como `pending` e responde
 * 2xx antes de processar — o status aqui é o que permite a varredura de
 * recuperação no boot achar o que ficou pelo caminho (crash, processo
 * derrubado no meio da triagem). CHECK aceita as três fases; mensagens `out`
 * nascem `processed` (default) porque não passam por triagem nem podem
 * "falhar" nesse sentido — assim a varredura de boot filtra só por
 * `processing_status = 'pending'` sem precisar também checar `direction`.
 */
export const coreMessagesProcessingStatus005: Migration = {
  id: '005_core_messages_processing_status',
  up(db) {
    db.exec(`
      ALTER TABLE messages ADD COLUMN processing_status TEXT NOT NULL
        DEFAULT 'processed' CHECK (processing_status IN ('pending', 'processed', 'failed'));

      CREATE INDEX messages_processing_status_lookup ON messages (processing_status, created_at);
    `);
  },
  down(db) {
    db.exec(`
      DROP INDEX IF EXISTS messages_processing_status_lookup;
      ALTER TABLE messages DROP COLUMN processing_status;
    `);
  },
};
