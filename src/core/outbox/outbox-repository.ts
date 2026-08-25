import type { Database } from 'better-sqlite3';

export interface OutboxMessageRow {
  id: number;
  job_id: number | null;
  jid: string;
  body: string;
  is_proactive: number;
  status: string;
  attempts: number;
  delivered_at: string | null;
  retry_after: string | null;
}

export interface EnqueueInput {
  jid: string;
  body: string;
  jobId?: number;
  isProactive?: boolean;
}

/** Única porta de leitura/escrita da fila de saída — nenhum módulo insere direto na tabela. */
export class OutboxRepository {
  constructor(private readonly db: Database) {}

  enqueue(input: EnqueueInput): number {
    const result = this.db
      .prepare(
        `INSERT INTO outbox_messages (job_id, jid, body, is_proactive, status, attempts)
         VALUES (?, ?, ?, ?, 'pending', 0)`,
      )
      .run(input.jobId ?? null, input.jid, input.body, input.isProactive ? 1 : 0);
    return Number(result.lastInsertRowid);
  }

  /** Exclui mensagens em backoff (`retry_after` no futuro) — o tick não reprocessa antes da hora. */
  findPending(nowIso: string): OutboxMessageRow[] {
    return this.db
      .prepare<[string], OutboxMessageRow>(
        `SELECT * FROM outbox_messages
         WHERE status = 'pending' AND (retry_after IS NULL OR retry_after <= ?)`,
      )
      .all(nowIso);
  }

  countProactiveSentSince(sinceIso: string): number {
    const row = this.db
      .prepare<[string], { count: number }>(
        `SELECT COUNT(*) as count FROM outbox_messages
         WHERE is_proactive = 1 AND status = 'delivered' AND delivered_at >= ?`,
      )
      .get(sinceIso);
    return row?.count ?? 0;
  }

  /**
   * Claim atômico: só transiciona quem ainda está `pending`. Duas execuções
   * concorrentes de processPending (tick do scheduler + disparo direto, ou
   * dois ticks intercalados por um sleep) nunca conseguem as duas marcar a
   * mesma linha como `sending` — a segunda vê `changes === 0` e desiste.
   */
  claimForSending(id: number): boolean {
    const result = this.db
      .prepare(`UPDATE outbox_messages SET status = 'sending', updated_at = datetime('now') WHERE id = ? AND status = 'pending'`)
      .run(id);
    return result.changes > 0;
  }

  markDelivered(id: number, deliveredAt: Date): void {
    this.db
      .prepare(
        `UPDATE outbox_messages SET status = 'delivered', delivered_at = ?, updated_at = datetime('now') WHERE id = ?`,
      )
      .run(deliveredAt.toISOString(), id);
  }

  markFailed(id: number): void {
    this.db
      .prepare(`UPDATE outbox_messages SET status = 'failed', updated_at = datetime('now') WHERE id = ?`)
      .run(id);
  }

  incrementAttempts(id: number): void {
    this.db
      .prepare(`UPDATE outbox_messages SET attempts = attempts + 1, updated_at = datetime('now') WHERE id = ?`)
      .run(id);
  }

  /** Volta pro estado pending, mas só reelegível após `retryAfter` (backoff exponencial). */
  markPendingForRetry(id: number, retryAfter: Date): void {
    this.db
      .prepare(
        `UPDATE outbox_messages SET status = 'pending', retry_after = ?, updated_at = datetime('now') WHERE id = ?`,
      )
      .run(retryAfter.toISOString(), id);
  }
}
