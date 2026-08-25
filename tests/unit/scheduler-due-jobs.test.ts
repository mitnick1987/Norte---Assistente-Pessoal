import { describe, expect, it } from 'vitest';
import { isDue, selectDueJobs, type DueJobCandidate } from '../../src/core/scheduler/domain/due-jobs.js';

const now = new Date('2026-08-25T12:00:00.000Z');

function buildJob(overrides: Partial<DueJobCandidate>): DueJobCandidate {
  return {
    id: 1,
    nextRunAt: new Date('2026-08-25T11:00:00.000Z'),
    status: 'pending',
    deliveredAt: null,
    ...overrides,
  };
}

describe('isDue', () => {
  it('considera vencido um job pending com next_run_at no passado', () => {
    expect(isDue(buildJob({}), now)).toBe(true);
  });

  it('inclui catch-up: job vencido há dias durante downtime também é elegível', () => {
    const job = buildJob({ nextRunAt: new Date('2026-08-20T00:00:00.000Z') });
    expect(isDue(job, now)).toBe(true);
  });

  it('não considera vencido um job com next_run_at no futuro', () => {
    const job = buildJob({ nextRunAt: new Date('2026-08-25T13:00:00.000Z') });
    expect(isDue(job, now)).toBe(false);
  });

  it('nunca redispara job que já tem delivered_at, mesmo com status pending', () => {
    const job = buildJob({ deliveredAt: new Date('2026-08-25T11:05:00.000Z') });
    expect(isDue(job, now)).toBe(false);
  });

  it('ignora job com status diferente de pending (running/confirmed/failed)', () => {
    expect(isDue(buildJob({ status: 'running' }), now)).toBe(false);
    expect(isDue(buildJob({ status: 'confirmed' }), now)).toBe(false);
    expect(isDue(buildJob({ status: 'failed' }), now)).toBe(false);
  });
});

describe('selectDueJobs', () => {
  it('filtra só os jobs vencidos de uma lista mista', () => {
    const jobs = [
      buildJob({ id: 1, nextRunAt: new Date('2026-08-25T11:00:00.000Z') }),
      buildJob({ id: 2, nextRunAt: new Date('2026-08-25T13:00:00.000Z') }),
      buildJob({ id: 3, status: 'confirmed' }),
    ];

    expect(selectDueJobs(jobs, now).map((j) => j.id)).toEqual([1]);
  });
});
