import { describe, expect, it } from 'vitest';
import { proactiveCapReached } from '../../src/core/outbox/domain/daily-cap.js';

describe('proactiveCapReached', () => {
  it('não bloqueia enquanto a contagem do dia está abaixo do teto', () => {
    expect(proactiveCapReached(3, 6)).toBe(false);
  });

  it('bloqueia exatamente ao atingir o teto', () => {
    expect(proactiveCapReached(6, 6)).toBe(true);
  });

  it('bloqueia acima do teto', () => {
    expect(proactiveCapReached(10, 6)).toBe(true);
  });
});
