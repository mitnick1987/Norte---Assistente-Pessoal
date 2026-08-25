import { describe, expect, it } from 'vitest';
import { randomSendDelayMs } from '../../src/core/outbox/domain/send-delay.js';

describe('randomSendDelayMs', () => {
  it('fica dentro da janela de 10 a 45s (política anti-banimento)', () => {
    for (const random of [0, 0.25, 0.5, 0.75, 0.999]) {
      const delay = randomSendDelayMs(() => random);
      expect(delay).toBeGreaterThanOrEqual(10_000);
      expect(delay).toBeLessThan(45_000);
    }
  });
});
