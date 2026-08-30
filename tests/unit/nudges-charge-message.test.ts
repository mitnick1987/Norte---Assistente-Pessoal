import { describe, expect, it } from 'vitest';
import { buildChargeMessage } from '../../src/modules/nudges/domain/index.js';
import { assertToneIsSafe } from '../tone/forbidden-patterns.js';

describe('buildChargeMessage (RF-08, RF-14: menu de cobrança 100% determinístico)', () => {
  it('sempre inclui o menu completo com as 3 opções', () => {
    const message = buildChargeMessage({ id: 1, title: 'pagar boleto' });

    expect(message).toContain('1) feito');
    expect(message).toContain('2) reagendar');
    expect(message).toContain('3) dropar');
  });

  it('sempre oferece a opção de dropar (spec item 6, TESTING.md §4.1)', () => {
    for (let id = 1; id <= 10; id++) {
      const message = buildChargeMessage({ id, title: `item ${id}` });
      expect(message).toContain('dropar');
    }
  });

  it('nunca menciona histórico de adiamentos ou quantas vezes o item já apareceu', () => {
    const message = buildChargeMessage({ id: 1, title: 'revisar contrato' });

    assertToneIsSafe(message);
  });

  it('mesmo item sempre produz a mesma mensagem (determinístico)', () => {
    const first = buildChargeMessage({ id: 5, title: 'pagar boleto' });
    const second = buildChargeMessage({ id: 5, title: 'pagar boleto' });

    expect(first).toBe(second);
  });

  it('inclui o título do item na mensagem', () => {
    const message = buildChargeMessage({ id: 1, title: 'ligar pro dentista' });

    expect(message).toContain('ligar pro dentista');
  });
});
