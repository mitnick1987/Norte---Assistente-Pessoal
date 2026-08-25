import type { Database } from 'better-sqlite3';
import type { RecurrenceRule } from './domain/index.js';

export interface JobRow {
  id: number;
  type: string;
  payload: string;
  next_run_at: string;
  recurrence: string | null;
  status: string;
  attempts: number;
  delivered_at: string | null;
}

export interface CreateJobInput {
  type: string;
  payload?: unknown;
  nextRunAt: Date;
  recurrence?: RecurrenceRule;
}

/** Toda leitura/escrita de `jobs` passa por aqui — nenhum módulo faz SQL direto na tabela. */
export class JobRepository {
  constructor(private readonly db: Database) {}

  create(input: CreateJobInput): number {
    const result = this.db
      .prepare(
        `INSERT INTO jobs (type, payload, next_run_at, recurrence, status, attempts)
         VALUES (?, ?, ?, ?, 'pending', 0)`,
      )
      .run(input.type, JSON.stringify(input.payload ?? {}), input.nextRunAt.toISOString(), input.recurrence ?? null);
    return Number(result.lastInsertRowid);
  }

  findPending(): JobRow[] {
    return this.db.prepare<[], JobRow>(`SELECT * FROM jobs WHERE status = 'pending'`).all();
  }

  findById(id: number): JobRow | undefined {
    return this.db.prepare<[number], JobRow>('SELECT * FROM jobs WHERE id = ?').get(id);
  }

  markRunning(id: number): void {
    this.db
      .prepare(`UPDATE jobs SET status = 'running', updated_at = datetime('now') WHERE id = ?`)
      .run(id);
  }

  markConfirmed(id: number, deliveredAt: Date): void {
    this.db
      .prepare(
        `UPDATE jobs SET status = 'confirmed', delivered_at = ?, updated_at = datetime('now') WHERE id = ?`,
      )
      .run(deliveredAt.toISOString(), id);
  }

  markFailed(id: number): void {
    this.db
      .prepare(`UPDATE jobs SET status = 'failed', updated_at = datetime('now') WHERE id = ?`)
      .run(id);
  }

  incrementAttempts(id: number): void {
    this.db
      .prepare(`UPDATE jobs SET attempts = attempts + 1, updated_at = datetime('now') WHERE id = ?`)
      .run(id);
  }

  /** Reabre o job para a próxima ocorrência — chamado só no momento do disparo (ADR-004). */
  rescheduleRecurring(id: number, nextRunAt: Date): void {
    this.db
      .prepare(
        `UPDATE jobs
         SET status = 'pending', next_run_at = ?, delivered_at = NULL, attempts = 0, updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(nextRunAt.toISOString(), id);
  }
}
