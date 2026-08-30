import type { JobRepository } from '../../core/scheduler/index.js';
import { COBRANCA_JOB_TYPE } from './manifest.js';

/**
 * Job durável (ADR-004) que reavalia elegibilidade de cobrança
 * periodicamente — nunca um cron em memória. Recorrência `every` (minutos)
 * em vez de `daily`: a checagem precisa rodar várias vezes ao dia para um
 * item que vence às 14h ser cobrado no mesmo dia, não só na manhã seguinte.
 * Idempotente — não duplica se já existe um job `pending` do tipo.
 */
export function ensureNudgesJob(jobRepository: JobRepository, checkIntervalMinutes: number, now: Date): void {
  const existing = jobRepository.findPendingByType(COBRANCA_JOB_TYPE);
  if (existing.length > 0) return;

  jobRepository.create({
    type: COBRANCA_JOB_TYPE,
    nextRunAt: new Date(now.getTime() + checkIntervalMinutes * 60_000),
    recurrence: { kind: 'every', minutes: checkIntervalMinutes },
  });
}
