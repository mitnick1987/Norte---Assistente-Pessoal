import type { Migration } from '../../kernel/types.js';

/**
 * FEAT-006 item 4 (achado de review): a janela de conversa do brain
 * (`message-repository.ts#findRecentConversation`) precisa distinguir turno
 * real (usuário fala, brain responde) de mensagem proativa (briefing,
 * revisão, lembrete — iniciada por um job, não por um turno do usuário).
 * Sem essa marca, uma proativa recente entra no histórico como se fosse
 * resposta do brain ao próprio usuário, poluindo o contexto da próxima
 * chamada ao Sonnet. Default 0 preserva todo dado existente como "não
 * proativo" — a distinção só passa a existir daqui pra frente.
 */
export const coreMessagesProactive008: Migration = {
  id: '008_core_messages_proactive',
  up(db) {
    db.exec(`
      ALTER TABLE messages ADD COLUMN is_proactive INTEGER NOT NULL DEFAULT 0 CHECK (is_proactive IN (0, 1));
    `);
  },
  down(db) {
    db.exec(`
      ALTER TABLE messages DROP COLUMN is_proactive;
    `);
  },
};
