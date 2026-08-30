import type { JobRepository } from '../../core/scheduler/index.js';
import { startOfZonedDay, zonedTimeToUtc } from '../../core/scheduler/domain/index.js';

export const BRIEFING_JOB_TYPE = 'briefing';
export const REVISAO_JOB_TYPE = 'revisao';

/**
 * Calcula o primeiro disparo (hoje se o horário ainda não passou, amanhã
 * caso contrário) — usado só para semear a linha inicial em `jobs`; toda
 * ocorrência seguinte é recalculada pelo scheduler no momento do disparo
 * (`recurrence: 'daily'`, ADR-004, mesmo mecanismo que `chains` usa para
 * cadeias recorrentes).
 */
export function nextDailyRunAt(hour: number, minute: number, now: Date): Date {
  const todayStart = startOfZonedDay(now);
  const candidate = zonedTimeToUtc({ ...todayStart, hour, minute, second: 0 });
  if (candidate.getTime() > now.getTime()) return candidate;

  const tomorrowStart = startOfZonedDay(new Date(zonedTimeToUtc(todayStart).getTime() + 24 * 60 * 60_000));
  return zonedTimeToUtc({ ...tomorrowStart, hour, minute, second: 0 });
}

/**
 * Job durável, nunca cron em memória (ADR-004): chamado uma vez no boot.
 * Idempotente — se já existe um job `pending` do tipo (agendado num boot
 * anterior), não cria um segundo; o catch-up do scheduler já cobre o caso de
 * o horário ter passado enquanto o processo estava fora do ar.
 */
export function ensureDailyRitualJob(
  jobRepository: JobRepository,
  jobType: string,
  hour: number,
  minute: number,
  now: Date,
): void {
  const existing = jobRepository.findPendingByType(jobType);
  if (existing.length > 0) return;

  jobRepository.create({
    type: jobType,
    nextRunAt: nextDailyRunAt(hour, minute, now),
    recurrence: 'daily',
  });
}
