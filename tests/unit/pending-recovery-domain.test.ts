import { describe, expect, it } from 'vitest';
import {
  isEligibleForRecovery,
  parseSqliteUtcTimestamp,
  selectRecoveryCandidates,
} from '../../src/core/channel/domain/pending-recovery.js';

describe('parseSqliteUtcTimestamp', () => {
  it('interpreta o timestamp gravado por datetime(\'now\') como UTC, não hora local', () => {
    const parsed = parseSqliteUtcTimestamp('2026-08-25 16:04:52');
    expect(parsed.toISOString()).toBe('2026-08-25T16:04:52.000Z');
  });
});

describe('isEligibleForRecovery (ADR-018)', () => {
  const now = new Date('2026-08-25T12:01:00.000Z');

  it('não é elegível quando a idade é menor que o limiar', () => {
    const candidate = { id: 1, createdAt: new Date('2026-08-25T12:00:30.000Z') };
    expect(isEligibleForRecovery(candidate, now, 60_000)).toBe(false);
  });

  it('é elegível exatamente no limiar (fronteira inclusiva)', () => {
    const candidate = { id: 1, createdAt: new Date('2026-08-25T12:00:00.000Z') };
    expect(isEligibleForRecovery(candidate, now, 60_000)).toBe(true);
  });

  it('é elegível quando a idade excede o limiar', () => {
    const candidate = { id: 1, createdAt: new Date('2026-08-25T11:00:00.000Z') };
    expect(isEligibleForRecovery(candidate, now, 60_000)).toBe(true);
  });
});

describe('selectRecoveryCandidates', () => {
  it('filtra só os candidatos elegíveis, preservando ordem', () => {
    const now = new Date('2026-08-25T12:01:00.000Z');
    const candidates = [
      { id: 1, createdAt: new Date('2026-08-25T11:00:00.000Z') }, // elegível
      { id: 2, createdAt: new Date('2026-08-25T12:00:59.000Z') }, // não elegível
      { id: 3, createdAt: new Date('2026-08-25T10:00:00.000Z') }, // elegível
    ];

    const result = selectRecoveryCandidates(candidates, now, 60_000);

    expect(result.map((c) => c.id)).toEqual([1, 3]);
  });
});
