import type { Migration } from '../../kernel/types.js';

/**
 * FEAT-003: `media_type` marca mensagens de entrada não-texto (hoje só
 * `audio`) para a varredura de recuperação saber que precisa buscar mídia de
 * novo, não só reler `body`. `transcricao` grava o texto transcrito antes de
 * seguir para a triagem — sobrevive mesmo que uma etapa posterior falhe
 * (depuração e idempotência do reprocessamento, spec item 2). `message_key_json`
 * guarda a `key` original da mensagem (serializada) — é o que
 * `getBase64FromMediaMessage` precisa para buscar a mídia de novo na
 * varredura de recuperação; sem isso a recuperação de áudio pending seria
 * impossível depois de um restart (a key não sobrevive só no `body`).
 */
export const coreMessagesMedia006: Migration = {
  id: '006_core_messages_media',
  up(db) {
    db.exec(`
      ALTER TABLE messages ADD COLUMN media_type TEXT CHECK (media_type IS NULL OR media_type IN ('audio'));
      ALTER TABLE messages ADD COLUMN transcricao TEXT;
      ALTER TABLE messages ADD COLUMN message_key_json TEXT;
    `);
  },
  down(db) {
    db.exec(`
      ALTER TABLE messages DROP COLUMN message_key_json;
      ALTER TABLE messages DROP COLUMN transcricao;
      ALTER TABLE messages DROP COLUMN media_type;
    `);
  },
};
