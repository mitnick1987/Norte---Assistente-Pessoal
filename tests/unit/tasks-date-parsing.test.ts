import { describe, expect, it } from 'vitest';
import { parseRelativeDatePtBr } from '../../src/modules/tasks/domain/date-parsing.js';

// Referência fixa: terça-feira 2026-08-25 10:00 America/Sao_Paulo (13:00 UTC).
const REFERENCE_NOW = new Date('2026-08-25T13:00:00.000Z');

describe('parseRelativeDatePtBr (TZ America/Sao_Paulo explícito)', () => {
  it('resolve "hoje" para o dia corrente, hora default 9h quando sem horário', () => {
    const result = parseRelativeDatePtBr('hoje', REFERENCE_NOW);

    expect(result).toBeDefined();
    expect(result!.dueAt.toISOString()).toBe('2026-08-25T12:00:00.000Z');
    expect(result!.hasExplicitTime).toBe(false);
  });

  it('resolve "amanhã 14h" com horário explícito', () => {
    const result = parseRelativeDatePtBr('amanhã 14h', REFERENCE_NOW);

    expect(result!.dueAt.toISOString()).toBe('2026-08-26T17:00:00.000Z');
    expect(result!.hasExplicitTime).toBe(true);
  });

  it('resolve "amanhã" sem horário para o horário default (9h)', () => {
    const result = parseRelativeDatePtBr('amanhã', REFERENCE_NOW);

    expect(result!.dueAt.toISOString()).toBe('2026-08-26T12:00:00.000Z');
    expect(result!.hasExplicitTime).toBe(false);
  });

  it('ignora hora fora do range válido (25h) e usa o default', () => {
    const result = parseRelativeDatePtBr('amanhã 25h', REFERENCE_NOW);

    expect(result!.dueAt.toISOString()).toBe('2026-08-26T12:00:00.000Z');
    expect(result!.hasExplicitTime).toBe(false);
  });

  it('resolve "sexta" para a próxima sexta-feira a partir de uma terça', () => {
    const result = parseRelativeDatePtBr('sexta', REFERENCE_NOW);

    // 2026-08-28 é sexta-feira.
    expect(result!.dueAt.toISOString()).toBe('2026-08-28T12:00:00.000Z');
  });

  it('resolve "sexta 14h30" com minutos explícitos', () => {
    const result = parseRelativeDatePtBr('sexta 14h30', REFERENCE_NOW);

    expect(result!.dueAt.toISOString()).toBe('2026-08-28T17:30:00.000Z');
  });

  it('"segunda que vem" pula para a segunda da semana seguinte, não a mais próxima', () => {
    // referência é terça; a segunda "mais próxima" já passou nesta semana,
    // então o cálculo cru já cairia na semana seguinte — o teste garante que
    // "que vem" não soma uma semana extra por engano.
    const result = parseRelativeDatePtBr('segunda que vem', REFERENCE_NOW);

    expect(result!.dueAt.toISOString()).toBe('2026-08-31T12:00:00.000Z');
  });

  it('cruza a virada de mês corretamente ("sexta" perto do fim de agosto)', () => {
    const lateAugust = new Date('2026-08-29T13:00:00.000Z'); // sábado 2026-08-29
    const result = parseRelativeDatePtBr('sexta', lateAugust);

    // Próxima sexta a partir de sábado 29/08 é 04/09.
    expect(result!.dueAt.toISOString()).toBe('2026-09-04T12:00:00.000Z');
  });

  it('cruza a virada de semana (domingo -> próxima segunda é já amanhã)', () => {
    const sunday = new Date('2026-08-30T13:00:00.000Z'); // domingo
    const result = parseRelativeDatePtBr('segunda', sunday);

    expect(result!.dueAt.toISOString()).toBe('2026-08-31T12:00:00.000Z');
  });

  it('retorna undefined para texto sem data relativa reconhecível', () => {
    expect(parseRelativeDatePtBr('só uma ideia solta', REFERENCE_NOW)).toBeUndefined();
  });
});
