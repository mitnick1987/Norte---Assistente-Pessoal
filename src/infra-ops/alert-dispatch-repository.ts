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
}
