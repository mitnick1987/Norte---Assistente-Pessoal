import type { JobRepository } from '../core/scheduler/index.js';

/**
 * Idempotente (mesmo padrão de `nudges/job-scheduling.ts`): não duplica se
 * já existe um job `pending` do tipo — chamado uma vez no boot, a
 * recorrência `every` reagenda sozinha a cada disparo (ADR-004).
 */
export function ensureRecurringJob(jobRepository: JobRepository, jobType: string, intervalMinutes: number, now: Date): void {
  const existing = jobRepository.findPendingByType(jobType);
  if (existing.length > 0) return;

  jobRepository.create({
    type: jobType,
    nextRunAt: new Date(now.getTime() + intervalMinutes * 60_000),
    recurrence: { kind: 'every', minutes: intervalMinutes },
  });
}
