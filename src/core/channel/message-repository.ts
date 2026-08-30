import type { Database } from 'better-sqlite3';

export interface RecordInboundInput {
  jid: string;
  waMessageId: string | undefined;
  body: string | undefined;
}

export interface RecordLlmUsageInput {
  jid: string;
  intent: string;
  tokensIn: number;
  tokensOut: number;
  cacheReadTokens: number;
}

export type RecordInboundResult = { readonly isNew: true; readonly messageId: number } | { readonly isNew: false };

export interface PendingMessageRow {
  readonly id: number;
  readonly jid: string;
  readonly body: string | null;
  readonly createdAt: string;
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

  /**
   * Grava a mensagem de entrada já como `pending` (ADR-018) — é a mesma
   * escrita que antes só resolvia dedup, sem escrita adicional. Retorna o id
   * para o chamador disparar o processamento em background e para o vínculo
   * `source_message_id` em `items`.
   */
  tryRecordInbound(input: RecordInboundInput): RecordInboundResult {
    if (!input.waMessageId) return { isNew: false };

    try {
      const result = this.db
        .prepare(
          `INSERT INTO messages (direction, wa_message_id, jid, body, processing_status)
           VALUES ('in', ?, ?, ?, 'pending')`,
        )
        .run(input.waMessageId, input.jid, input.body ?? null);
      return { isNew: true, messageId: Number(result.lastInsertRowid) };
    } catch (err) {
      if (isUniqueConstraintError(err)) return { isNew: false };
      throw err;
    }
  }

  recordOutbound(jid: string, body: string): void {
    this.db.prepare(`INSERT INTO messages (direction, jid, body) VALUES ('out', ?, ?)`).run(jid, body);
  }

  /**
   * Base do monitor de custo (RF-15): uma linha por chamada ao LLM, sem
   * `wa_message_id` (não é webhook, não participa do dedup) — `intent`
   * carrega o papel da chamada (ex.: "triagem") para o relatório mensal
   * futuro distinguir triagem de conversa.
   */
  recordLlmUsage(input: RecordLlmUsageInput): void {
    this.db
      .prepare(
        `INSERT INTO messages (direction, jid, intent, tokens_in, tokens_out, cache_read_tokens)
         VALUES ('in', ?, ?, ?, ?, ?)`,
      )
      .run(input.jid, input.intent, input.tokensIn, input.tokensOut, input.cacheReadTokens);
  }

  markProcessed(messageId: number): void {
    this.db.prepare(`UPDATE messages SET processing_status = 'processed' WHERE id = ?`).run(messageId);
  }

  markFailed(messageId: number): void {
    this.db.prepare(`UPDATE messages SET processing_status = 'failed' WHERE id = ?`).run(messageId);
  }

  /**
   * Candidatas à varredura de recuperação no boot (ADR-018): todas as
   * mensagens de entrada ainda `pending`, sem filtro de idade aqui — o corte
   * pelo limiar é feito em JS (mesmo padrão do scheduler, due-jobs.ts) para
   * não depender de comparação de string de data em SQL (created_at usa
   * `datetime('now')`, formato diferente de `Date#toISOString()`).
   */
  findPendingInbound(): PendingMessageRow[] {
    return this.db
      .prepare<[], { id: number; jid: string; body: string | null; created_at: string }>(
        `SELECT id, jid, body, created_at FROM messages
         WHERE direction = 'in' AND processing_status = 'pending'
         ORDER BY created_at ASC`,
      )
      .all()
      .map((row) => ({ id: row.id, jid: row.jid, body: row.body, createdAt: row.created_at }));
  }
}

function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Error && err.message.includes('UNIQUE constraint failed');
}
