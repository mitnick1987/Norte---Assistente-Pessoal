import type { Database } from 'better-sqlite3';

/** Toda leitura/escrita de `infra_ops_alert_dispatches` passa por aqui — nenhum SQL direto fora deste arquivo. */
export class AlertDispatchRepository {
  constructor(private readonly db: Database) {}

  findLastSentAt(alertKey: string): Date | undefined {
    const row = this.db
      .prepare<[string], { last_sent_at: string }>('SELECT last_sent_at FROM infra_ops_alert_dispatches WHERE alert_key = ?')
      .get(alertKey);
    return row ? new Date(row.last_sent_at) : undefined;
  }

  recordSent(alertKey: string, sentAt: Date): void {
    this.db
      .prepare(
        `INSERT INTO infra_ops_alert_dispatches (alert_key, last_sent_at) VALUES (?, ?)
         ON CONFLICT(alert_key) DO UPDATE SET last_sent_at = excluded.last_sent_at`,
      )
      .run(alertKey, sentAt.toISOString());
  }

  /**
   * Check-and-set atômico do anti-flood (achado de review FEAT-008): o
   * antigo par findLastSentAt→(envia)→recordSent é check-then-act com um
   * `await` de I/O de rede entre o check e a gravação — duas chamadas
   * concorrentes do mesmo alerta podem ambas ler "fora da janela" antes de
   * qualquer uma gravar, e as duas enviam. `tryClaim` fecha essa janela:
   * grava o `last_sent_at` ANTES do envio, numa única declaração SQL
   * (better-sqlite3 é síncrono — não há ponto de suspensão entre o
   * `WHERE` e o `UPDATE`/`INSERT`, então dois `tryClaim` concorrentes no
   * mesmo processo nunca intercalam). Só quem reivindica o slot envia; se o
   * envio falhar depois, o slot já foi consumido — comportamento aceito
   * porque a falha de envio já cai em log `error` (dispatch não reagenda).
   */
  tryClaim(alertKey: string, now: Date, windowMs: number): boolean {
    const cutoff = new Date(now.getTime() - windowMs).toISOString();
    const result = this.db
      .prepare(
        `INSERT INTO infra_ops_alert_dispatches (alert_key, last_sent_at) VALUES (?, ?)
         ON CONFLICT(alert_key) DO UPDATE SET last_sent_at = excluded.last_sent_at
         WHERE infra_ops_alert_dispatches.last_sent_at <= ?`,
      )
      .run(alertKey, now.toISOString(), cutoff);
    return result.changes > 0;
  }
}
