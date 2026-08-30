export interface PendingRecoveryCandidate {
  readonly id: number;
  readonly createdAt: Date;
}

/**
 * `created_at` é gravado por `datetime('now')` (formato SQLite, sem `T`/`Z`)
 * — parsear direto com `new Date()` interpretaria como hora local do
 * processo, não UTC, e o cálculo de idade ficaria errado dependendo do TZ do
 * host. Normaliza para ISO explícito antes de converter (CODE_STYLE §2: UTC
 * no banco, TZ só na borda).
 */
export function parseSqliteUtcTimestamp(value: string): Date {
  return new Date(`${value.replace(' ', 'T')}Z`);
}

/**
 * Elegibilidade da varredura de recuperação no boot (ADR-018): mesmo
 * espírito do `isDue` do scheduler (due-jobs.ts) — filtro de idade decidido
 * em JS puro, testável sem SQL, para não depender de comparação de string de
 * data em SQL.
 */
export function isEligibleForRecovery(
  candidate: PendingRecoveryCandidate,
  now: Date,
  thresholdMs: number,
): boolean {
  return now.getTime() - candidate.createdAt.getTime() >= thresholdMs;
}

export function selectRecoveryCandidates<T extends PendingRecoveryCandidate>(
  candidates: readonly T[],
  now: Date,
  thresholdMs: number,
): readonly T[] {
  return candidates.filter((candidate) => isEligibleForRecovery(candidate, now, thresholdMs));
}
