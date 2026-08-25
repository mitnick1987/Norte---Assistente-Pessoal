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
 */
export class MessageRepository {
  constructor(private readonly db: Database) {}

  tryRecordInbound(input: RecordInboundInput): boolean {
    try {
      this.db
        .prepare(`INSERT INTO messages (direction, wa_message_id, jid, body) VALUES ('in', ?, ?, ?)`)
        .run(input.waMessageId ?? null, input.jid, input.body ?? null);
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
