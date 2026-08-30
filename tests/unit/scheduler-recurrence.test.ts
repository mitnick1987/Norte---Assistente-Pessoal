import { describe, expect, it } from 'vitest';
import { nextOccurrence } from '../../src/core/scheduler/domain/recurrence.js';
import { toZonedParts } from '../../src/core/scheduler/domain/timezone.js';

describe('nextOccurrence', () => {
  it('gera a ocorrência diária seguinte no mesmo horário de parede em America/Sao_Paulo', () => {
    // 2026-08-25 07:40 America/Sao_Paulo == 10:40 UTC
    const fireAt = new Date('2026-08-25T10:40:00.000Z');

    const next = nextOccurrence(fireAt, 'daily');
    const parts = toZonedParts(next);

    expect(parts).toEqual({ year: 2026, month: 8, day: 26, hour: 7, minute: 40, second: 0 });
  });

  it('cruza a virada de mês corretamente (recorrência mensal)', () => {
    // 2026-08-31 21:30 America/Sao_Paulo
    const fireAt = new Date('2026-09-01T00:30:00.000Z');

    const next = nextOccurrence(fireAt, 'monthly');
    const parts = toZonedParts(next);

    // Setembro tem 30 dias — dia 31 não existe, cai no último dia do mês.
    expect(parts).toEqual({ year: 2026, month: 9, day: 30, hour: 21, minute: 30, second: 0 });
  });

  it('cruza meia-noite corretamente na recorrência diária', () => {
    // 2026-08-25 23:50 America/Sao_Paulo == 2026-08-26 02:50 UTC
    const fireAt = new Date('2026-08-26T02:50:00.000Z');

    const next = nextOccurrence(fireAt, 'daily');
    const parts = toZonedParts(next);

    expect(parts).toEqual({ year: 2026, month: 8, day: 26, hour: 23, minute: 50, second: 0 });
  });

  it('gera a ocorrência semanal 7 dias depois, preservando hora', () => {
    const fireAt = new Date('2026-08-25T10:40:00.000Z');

    const next = nextOccurrence(fireAt, 'weekly');
    const parts = toZonedParts(next);

    expect(parts).toEqual({ year: 2026, month: 9, day: 1, hour: 7, minute: 40, second: 0 });
  });

  it('recorrência composta "every" (FEAT-007, job cobranca): soma minutos diretamente ao instante do disparo', () => {
    const fireAt = new Date('2026-08-25T10:40:00.000Z');

    const next = nextOccurrence(fireAt, { kind: 'every', minutes: 60 });

    expect(next.toISOString()).toBe('2026-08-25T11:40:00.000Z');
  });

  it('recorrência "every" cruzando meia-noite (America/Sao_Paulo) soma minutos em UTC sem depender de fuso', () => {
    // 2026-08-25 23:50 America/Sao_Paulo == 2026-08-26 02:50 UTC
    const fireAt = new Date('2026-08-26T02:50:00.000Z');

    const next = nextOccurrence(fireAt, { kind: 'every', minutes: 30 });

    expect(next.toISOString()).toBe('2026-08-26T03:20:00.000Z');
  });
});
