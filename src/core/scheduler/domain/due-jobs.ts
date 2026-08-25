export interface DueJobCandidate {
  readonly id: number;
  readonly nextRunAt: Date;
  readonly status: string;
  readonly deliveredAt: Date | null;
}

/**
 * Elegibilidade de disparo, incluindo catch-up de jobs vencidos durante um
 * restart (ADR-004). Um job com delivered_at já preenchido nunca é
 * reconsiderado — evita duplicar envio no catch-up do boot mesmo que o
 * status tenha ficado inconsistente por alguma falha anterior.
 */
export function isDue(job: DueJobCandidate, now: Date): boolean {
  if (job.deliveredAt !== null) return false;
  if (job.status !== 'pending') return false;
  return job.nextRunAt.getTime() <= now.getTime();
}

export function selectDueJobs(jobs: readonly DueJobCandidate[], now: Date): readonly DueJobCandidate[] {
  return jobs.filter((job) => isDue(job, now));
}
