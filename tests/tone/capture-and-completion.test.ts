import { describe, expect, it } from 'vitest';
import { COMPLETION_MESSAGE_VARIATIONS } from '../../src/modules/tasks/domain/index.js';
import { buildCaptureConfirmation, pickConversationFallback } from '../../src/modules/capture/domain/index.js';
import { assertToneIsSafe } from './forbidden-patterns.js';

/**
 * Suite de TOM (RF-14, TESTING.md §4.1): confirmação de captura,
 * reconhecimento de conclusão e resposta padrão de conversa — os três
 * templates desta entrega. Roda sem LLM: são bancos estáticos de variação.
 */
describe('suite de tom — confirmação de captura', () => {
  it('confirmação de item único nunca faz pergunta de estrutura', () => {
    const message = buildCaptureConfirmation([{ title: 'pagar boleto', dueExpressionUnresolved: false }], 0);

    assertToneIsSafe(message);
    expect(message).not.toMatch(/\?/);
    expect(message.split('\n')).toHaveLength(1);
  });

  it('confirmação de múltiplos itens é 1 linha, sem listar título por título', () => {
    const message = buildCaptureConfirmation(
      [
        { title: 'a', dueExpressionUnresolved: false },
        { title: 'b', dueExpressionUnresolved: false },
      ],
      0,
    );

    assertToneIsSafe(message);
    expect(message.split('\n')).toHaveLength(1);
  });

  it('todas as variações de confirmação passam no filtro de tom', () => {
    for (let seed = 0; seed < 10; seed++) {
      const message = buildCaptureConfirmation([{ title: 'x', dueExpressionUnresolved: false }], seed);
      assertToneIsSafe(message);
    }
  });

  it('data não reconhecida gera aviso honesto em 1 linha, sem pergunta de estrutura (ADR-006)', () => {
    for (let seed = 0; seed < 5; seed++) {
      const message = buildCaptureConfirmation([{ title: 'dentista', dueExpressionUnresolved: true }], seed);

      assertToneIsSafe(message);
      expect(message).not.toMatch(/\?/);
      expect(message.split('\n')).toHaveLength(1);
      expect(message.toLowerCase()).toMatch(/não entendi|não ficou clara/);
    }
  });
});

describe('suite de tom — reconhecimento de conclusão', () => {
  it('nenhuma variação de reconhecimento de conclusão menciona adiamentos ou histórico', () => {
    for (const message of COMPLETION_MESSAGE_VARIATIONS) {
      assertToneIsSafe(message);
    }
  });

  it('reconhecimento de conclusão é sempre 1 linha, sem pergunta', () => {
    for (const message of COMPLETION_MESSAGE_VARIATIONS) {
      expect(message.split('\n')).toHaveLength(1);
      expect(message).not.toMatch(/\?/);
    }
  });
});

describe('suite de tom — resposta padrão de conversa', () => {
  it('resposta padrão é honesta, nunca um "não entendi" evasivo, e passa no filtro de tom', () => {
    for (let seed = 0; seed < 5; seed++) {
      const message = pickConversationFallback(seed);
      assertToneIsSafe(message);
      expect(message.toLowerCase()).not.toContain('não entendi');
    }
  });
});
