import { describe, expect, it } from 'vitest';
import { diskUsageExceeded, diskUsagePercent } from '../../src/infra-ops/domain/disk-usage.js';

describe('diskUsagePercent', () => {
  it('calcula a porcentagem usada a partir de total e livre', () => {
    expect(diskUsagePercent(100, 20)).toBe(80);
  });

  it('disco vazio (livre = total) dá 0%', () => {
    expect(diskUsagePercent(100, 100)).toBe(0);
  });

  it('disco cheio (livre = 0) dá 100%', () => {
    expect(diskUsagePercent(100, 0)).toBe(100);
  });

  it('total zero ou negativo não gera divisão por zero/infinito', () => {
    expect(diskUsagePercent(0, 0)).toBe(0);
  });
});

describe('diskUsageExceeded', () => {
  it('true quando o uso passa do limiar', () => {
    expect(diskUsageExceeded(90, 85)).toBe(true);
  });

  it('false quando o uso está abaixo do limiar', () => {
    expect(diskUsageExceeded(80, 85)).toBe(false);
  });

  it('false quando o uso é exatamente o limiar (limite não é excedido no igual)', () => {
    expect(diskUsageExceeded(85, 85)).toBe(false);
  });
});
