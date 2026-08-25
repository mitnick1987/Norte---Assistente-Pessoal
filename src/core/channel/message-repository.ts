import type { Database } from 'better-sqlite3';

export interface RecordInboundInput {
  jid: string;
  waMessageId: string | undefined;
  body: string | undefined;
}

/**
 * Dedup por `wa_message_id` via índice único parcial (migração 001): a
 * inserção falha com SQLITE_CONSTRAINT quando a Evolution reentrega o
 * mesmo webhook, e é isso que usamos para decidir "já processamos".
 *
 * O índice é parcial (`WHERE wa_message_id IS NOT NULL`) — SQLite nunca
 * colide dois NULLs, então uma entrada sem id furaria o dedup em silêncio.
 * A rota já rejeita isso antes de chegar aqui (fail-closed no webhook), mas
 * o repository também recusa como segunda barreira: nenhum chamador
 * consegue gravar uma mensagem indeduplicável por essa via.
 */
export class MessageRepository {
  constructor(private readonly db: Database) {}

  tryRecordInbound(input: RecordInboundInput): boolean {
    if (!input.waMessageId) return false;

    try {
      this.db
        .prepare(`INSERT INTO messages (direction, wa_message_id, jid, body) VALUES ('in', ?, ?, ?)`)
        .run(input.waMessageId, input.jid, input.body ?? null);
      return true;
    } catch (err) {
      if (isUniqueConstraintError(err)) return false;
      throw err;
    }
  }

  recordOutbound(jid: string, body: string): void {
    this.db.prepare(`INSERT INTO messages (direction, jid, body) VALUES ('out', ?, ?)`).run(jid, body);
  }
}

function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Error && err.message.includes('UNIQUE constraint failed');
}
