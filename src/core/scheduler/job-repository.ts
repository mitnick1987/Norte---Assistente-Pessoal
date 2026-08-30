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

/**
 * `recurrence` é sempre serializado como TEXT: regra simples (`'daily'`) vira
 * a própria string, regra composta (`{ kind: 'every', minutes }`, FEAT-007)
 * vira JSON — o SQLite (better-sqlite3) não aceita bind de objeto cru, e a
 * leitura (`parseRecurrence`) faz o caminho inverso antes de repassar ao
 * cálculo de próxima ocorrência.
 */
function serializeRecurrence(recurrence: RecurrenceRule | undefined): string | null {
  if (recurrence === undefined) return null;
  return typeof recurrence === 'string' ? recurrence : JSON.stringify(recurrence);
}

export function parseRecurrence(value: string | null): RecurrenceRule | undefined {
  if (!value) return undefined;
  if (value === 'daily' || value === 'weekly' || value === 'monthly') return value;

  try {
    const parsed = JSON.parse(value) as Partial<{ kind: string; minutes: number }>;
    if (parsed.kind === 'every' && typeof parsed.minutes === 'number') {
      return { kind: 'every', minutes: parsed.minutes };
    }
  } catch {
    // cai no undefined abaixo — payload de recorrência corrompido nunca derruba o job, só para de recorrer.
  }
  return undefined;
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
      .run(input.type, JSON.stringify(input.payload ?? {}), input.nextRunAt.toISOString(), serializeRecurrence(input.recurrence));
    return Number(result.lastInsertRowid);
  }

  findPending(): JobRow[] {
    return this.db.prepare<[], JobRow>(`SELECT * FROM jobs WHERE status = 'pending'`).all();
  }

  /** Usado por `chains` para localizar a cadeia de um evento na hora de cancelar/regenerar — filtro por tipo primeiro porque é o índice existente (`jobs_due_lookup`), o payload é lido em código depois. */
  findPendingByType(type: string): JobRow[] {
    return this.db
      .prepare<[string], JobRow>(`SELECT * FROM jobs WHERE type = ? AND status = 'pending'`)
      .all(type);
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

  /** Cancelamento de rotina (drop/reagendamento) — nunca `failed`: a métrica de entrega (ARCHITECTURE.md §6) conta falha real, não intenção do dono mudando. */
  markCancelled(id: number): void {
    this.db
      .prepare(`UPDATE jobs SET status = 'cancelado', updated_at = datetime('now') WHERE id = ?`)
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
