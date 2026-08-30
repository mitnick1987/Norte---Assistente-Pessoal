import { describe, expect, it } from 'vitest';
import { selectMostFrequentWindow, formatWindowLabel } from '../../src/modules/nudges/domain/index.js';

describe('selectMostFrequentWindow (RF-08, agregado mínimo de patterns)', () => {
  it('sem amostras, nenhum padrão', () => {
    expect(selectMostFrequentWindow([])).toBeUndefined();
  });

  it('escolhe o horário mais frequente entre as amostras', () => {
    const samples = [
      { weekday: 6, hour: 9 },
      { weekday: 6, hour: 9 },
      { weekday: 2, hour: 14 },
    ];

    expect(selectMostFrequentWindow(samples)).toEqual({ weekday: 6, hour: 9 });
  });

  it('empate resolvido pela amostra mais recente (último índice), nunca aleatório', () => {
    const samples = [
      { weekday: 6, hour: 9 },
      { weekday: 2, hour: 14 },
    ];

    expect(selectMostFrequentWindow(samples)).toEqual({ weekday: 2, hour: 14 });
  });

  it('mesmo input sempre produz o mesmo resultado (determinístico)', () => {
    const samples = [
      { weekday: 6, hour: 9 },
      { weekday: 6, hour: 9 },
      { weekday: 0, hour: 10 },
    ];

    expect(selectMostFrequentWindow(samples)).toEqual(selectMostFrequentWindow(samples));
  });
});

describe('formatWindowLabel (nunca "para quando?")', () => {
  it('formata dia da semana + período + hora concreta', () => {
    expect(formatWindowLabel({ weekday: 6, hour: 9 })).toBe('sábado de manhã, 9h');
  });

  it('nunca contém a pergunta "para quando"', () => {
    const label = formatWindowLabel({ weekday: 2, hour: 20 });

    expect(label.toLowerCase()).not.toContain('para quando');
  });

  it('período à tarde para horas entre 12 e 17', () => {
    expect(formatWindowLabel({ weekday: 1, hour: 14 })).toContain('à tarde');
  });

  it('período à noite para horas >= 18', () => {
    expect(formatWindowLabel({ weekday: 1, hour: 19 })).toContain('à noite');
  });
});
