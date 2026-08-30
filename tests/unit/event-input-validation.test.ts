import { describe, expect, it } from 'vitest';
import { validateEventDates } from '../../src/modules/integrations/google-calendar/domain/event-input-validation.js';

const NOW = new Date('2026-09-01T12:00:00.000Z');

/**
 * `validateEventDates` é a guarda de backend contra a tool `create_event`
 * aceitar uma data fora de qualquer intervalo sensato (spec FEAT-006, item 2
 * e Impacto técnico — área sensível): o brain formula `startAt` a partir da
 * data injetada no prompt, mas o backend nunca confia cegamente nisso.
 * `google-calendar-service.test.ts` já cobre a integração com
 * `createEventFromBrain`; aqui isolamos a função pura, fronteira a
 * fronteira, como exige TESTING.md §1 para domínio crítico.
 */
describe('validateEventDates (domínio puro, ADR-019/FEAT-006 item 2)', () => {
  it('data futura próxima com endAt depois do startAt é válida', () => {
    const result = validateEventDates(
      new Date('2026-09-04T13:00:00.000Z'),
      new Date('2026-09-04T14:00:00.000Z'),
      NOW,
    );

    expect(result).toEqual({ valid: true });
  });

  it('startAt no exato instante now é válido (fronteira, não passado)', () => {
    const result = validateEventDates(NOW, new Date(NOW.getTime() + 60_000), NOW);

    expect(result.valid).toBe(true);
  });

  it('startAt poucos segundos no passado, dentro da tolerância, ainda é válido (evita rejeitar por atraso de rede)', () => {
    const startAt = new Date(NOW.getTime() - 60_000); // 1 min atrás, dentro da margem de 5 min
    const result = validateEventDates(startAt, new Date(NOW.getTime() + 3_600_000), NOW);

    expect(result.valid).toBe(true);
  });

  it('startAt além da tolerância de passado é rejeitado com reason in_past', () => {
    const startAt = new Date(NOW.getTime() - 10 * 60_000); // 10 min atrás, além da margem de 5 min
    const result = validateEventDates(startAt, new Date(NOW.getTime() + 3_600_000), NOW);

    expect(result).toEqual({ valid: false, reason: 'in_past' });
  });

  it('passado distante (anos atrás) é rejeitado com reason in_past', () => {
    const result = validateEventDates(new Date('2020-01-01T13:00:00.000Z'), new Date('2020-01-01T14:00:00.000Z'), NOW);

    expect(result).toEqual({ valid: false, reason: 'in_past' });
  });

  it('exatamente MAX_FUTURE_YEARS no futuro ainda é válido (fronteira inclusiva)', () => {
    const maxFuture = new Date(NOW);
    maxFuture.setFullYear(maxFuture.getFullYear() + 5);
    const result = validateEventDates(maxFuture, new Date(maxFuture.getTime() + 3_600_000), NOW);

    expect(result.valid).toBe(true);
  });

  it('um dia além do limite de anos no futuro é rejeitado com reason too_far_in_future', () => {
    const beyondLimit = new Date(NOW);
    beyondLimit.setFullYear(beyondLimit.getFullYear() + 5);
    beyondLimit.setDate(beyondLimit.getDate() + 1);
    const result = validateEventDates(beyondLimit, new Date(beyondLimit.getTime() + 3_600_000), NOW);

    expect(result).toEqual({ valid: false, reason: 'too_far_in_future' });
  });

  it('ano absurdamente distante (ex.: alucinação de ano pelo modelo) é rejeitado', () => {
    const result = validateEventDates(new Date('2099-01-01T13:00:00.000Z'), new Date('2099-01-01T14:00:00.000Z'), NOW);

    expect(result).toEqual({ valid: false, reason: 'too_far_in_future' });
  });

  it('endAt igual a startAt (duração zero) é rejeitado com reason end_before_start', () => {
    const startAt = new Date('2026-09-04T13:00:00.000Z');
    const result = validateEventDates(startAt, startAt, NOW);

    expect(result).toEqual({ valid: false, reason: 'end_before_start' });
  });

  it('endAt antes de startAt (duração negativa) é rejeitado com reason end_before_start', () => {
    const result = validateEventDates(new Date('2026-09-04T14:00:00.000Z'), new Date('2026-09-04T13:00:00.000Z'), NOW);

    expect(result).toEqual({ valid: false, reason: 'end_before_start' });
  });

  it('in_past é verificado antes de end_before_start quando os dois problemas coexistem (reason mais relevante primeiro)', () => {
    // ambos startAt e endAt no passado distante, com endAt < startAt.
    const result = validateEventDates(new Date('2020-01-02T00:00:00.000Z'), new Date('2020-01-01T00:00:00.000Z'), NOW);

    expect(result).toEqual({ valid: false, reason: 'in_past' });
  });
});
