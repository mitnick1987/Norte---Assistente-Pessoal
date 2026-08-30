import type { Database } from 'better-sqlite3';

export interface OutboxMessageRow {
  id: number;
  job_id: number | null;
  jid: string;
  body: string;
  is_proactive: number;
  is_anchor_ritual: number;
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
  /**
   * Marca a mensagem como ritual-âncora (briefing, revisão — RF-05/RF-06)
   * para fins só de ORDENAÇÃO dentro do teto diário, que continua limite
   * duro (RF-24: "teto diário permanece como limite duro em settings") — não
   * isenta, nem pula a checagem de `proactiveCapReached`. Rituais-âncora só
   * ganham prioridade de fila (`findPending`) para serem os ÚLTIMOS a esbarrar
   * no teto num mesmo tick, nunca os primeiros represados atrás de uma
   * cobrança/lembrete comum.
   */
  isAnchorRitual?: boolean;
}

/** Única porta de leitura/escrita da fila de saída — nenhum módulo insere direto na tabela. */
export class OutboxRepository {
  constructor(private readonly db: Database) {}

  enqueue(input: EnqueueInput): number {
    const result = this.db
      .prepare(
        `INSERT INTO outbox_messages (job_id, jid, body, is_proactive, is_anchor_ritual, status, attempts)
         VALUES (?, ?, ?, ?, ?, 'pending', 0)`,
      )
      .run(input.jobId ?? null, input.jid, input.body, input.isProactive ? 1 : 0, input.isAnchorRitual ? 1 : 0);
    return Number(result.lastInsertRowid);
  }

  /**
   * Exclui mensagens em backoff (`retry_after` no futuro) — o tick não
   * reprocessa antes da hora. Ritual-âncora (briefing/revisão) vem primeiro
   * na fila: o teto diário continua limite duro (RF-24) — nenhuma mensagem
   * pula a checagem —, mas processar rituais-âncora antes de lembretes/
   * cobranças comuns no mesmo tick garante que, se o teto for atingido
   * durante o processamento, é uma proativa comum que fica represada, nunca
   * o briefing/revisão (PRD §7: "briefing e revisão nunca deixam de chegar").
   */
  findPending(nowIso: string): OutboxMessageRow[] {
    return this.db
      .prepare<[string], OutboxMessageRow>(
        `SELECT * FROM outbox_messages
         WHERE status = 'pending' AND (retry_after IS NULL OR retry_after <= ?)
         ORDER BY is_anchor_ritual DESC, id ASC`,
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
