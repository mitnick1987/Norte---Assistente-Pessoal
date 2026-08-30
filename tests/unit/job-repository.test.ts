import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/core/db/migrator.js';
import { coreMigrations } from '../../src/core/db/migrations/index.js';
import { JobRepository } from '../../src/core/scheduler/job-repository.js';

function buildRepository(): { db: Database.Database; repository: JobRepository } {
  const db = new Database(':memory:');
  runMigrations(db, coreMigrations);
  return { db, repository: new JobRepository(db) };
}

describe('JobRepository', () => {
  it('cria job pending com attempts zerado', () => {
    const { repository } = buildRepository();
    const id = repository.create({ type: 'reminder', nextRunAt: new Date() });

    const row = repository.findById(id);

    expect(row).toMatchObject({ type: 'reminder', status: 'pending', attempts: 0 });
  });

  it('findPending retorna somente jobs com status pending', () => {
    const { repository } = buildRepository();
    const id = repository.create({ type: 'reminder', nextRunAt: new Date() });
    repository.markRunning(id);

    expect(repository.findPending()).toHaveLength(0);
  });

  it('markConfirmed grava delivered_at e muda status', () => {
    const { repository } = buildRepository();
    const id = repository.create({ type: 'reminder', nextRunAt: new Date() });
    const deliveredAt = new Date('2026-08-25T12:00:00.000Z');

    repository.markConfirmed(id, deliveredAt);

    const row = repository.findById(id);
    expect(row?.status).toBe('confirmed');
    expect(row?.delivered_at).toBe(deliveredAt.toISOString());
  });

  it('rescheduleRecurring volta o job para pending com nova data e reseta contadores', () => {
    const { repository } = buildRepository();
    const id = repository.create({ type: 'briefing', nextRunAt: new Date(), recurrence: 'daily' });
    repository.markRunning(id);
    repository.incrementAttempts(id);

    const next = new Date('2026-08-26T10:40:00.000Z');
    repository.rescheduleRecurring(id, next);

    const row = repository.findById(id);
    expect(row).toMatchObject({ status: 'pending', attempts: 0, delivered_at: null });
    expect(row?.next_run_at).toBe(next.toISOString());
  });

  it('markFailed muda status para failed', () => {
    const { repository } = buildRepository();
    const id = repository.create({ type: 'reminder', nextRunAt: new Date() });

    repository.markFailed(id);

    expect(repository.findById(id)?.status).toBe('failed');
  });

  it('markCancelled muda status para cancelado (drop/reagendamento de rotina, nunca failed)', () => {
    const { repository } = buildRepository();
    const id = repository.create({ type: 'reminder', nextRunAt: new Date() });

    repository.markCancelled(id);

    expect(repository.findById(id)?.status).toBe('cancelado');
  });

  it('payload é serializado e recuperável como JSON', () => {
    const { repository } = buildRepository();
    const id = repository.create({ type: 'reminder', nextRunAt: new Date(), payload: { itemId: 42 } });

    const row = repository.findById(id);
    expect(JSON.parse(row!.payload)).toEqual({ itemId: 42 });
  });
});
