import { describe, expect, it } from 'vitest';
import { nextRetryDelayMs, retriesExhausted, MAX_ATTEMPTS } from '../../src/core/outbox/domain/backoff.js';

describe('nextRetryDelayMs', () => {
  it('cresce exponencialmente a cada tentativa', () => {
    expect(nextRetryDelayMs(0)).toBe(60_000);
    expect(nextRetryDelayMs(1)).toBe(120_000);
    expect(nextRetryDelayMs(2)).toBe(240_000);
    expect(nextRetryDelayMs(3)).toBe(480_000);
  });

  it('capa o delay em 1h para não travar um job indefinidamente em outage prolongado', () => {
    expect(nextRetryDelayMs(10)).toBe(60 * 60_000);
  });
});

describe('retriesExhausted', () => {
  it('não esgota antes do teto de tentativas', () => {
    expect(retriesExhausted(MAX_ATTEMPTS - 1)).toBe(false);
  });

  it('esgota exatamente no teto de tentativas', () => {
    expect(retriesExhausted(MAX_ATTEMPTS)).toBe(true);
  });
});
