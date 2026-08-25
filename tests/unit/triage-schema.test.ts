import { describe, expect, it } from 'vitest';
import { triageOutputSchema } from '../../src/modules/capture/domain/triage-schema.js';
import { TRIAGE_SYSTEM_PROMPT } from '../../src/modules/capture/domain/triage-prompt.js';

describe('schema de saída da triagem (round-trip)', () => {
  it('aceita captura com múltiplos itens, alguns com dueAt', () => {
    const input = {
      classification: 'captura',
      items: [
        { type: 'tarefa', title: 'pagar boleto', dueAt: '2026-08-28T17:00:00.000Z' },
        { type: 'ideia', title: 'app de lembretes' },
      ],
    };

    const result = triageOutputSchema.parse(input);

    expect(result).toEqual(input);
  });

  it('rejeita classification fora do enum', () => {
    expect(triageOutputSchema.safeParse({ classification: 'spam', items: [] }).success).toBe(false);
  });

  it('rejeita campo desconhecido (additionalProperties: false)', () => {
    const result = triageOutputSchema.safeParse({ classification: 'conversa', items: [], extra: true });
    expect(result.success).toBe(false);
  });

  it('items é opcional na entrada e vira array vazio', () => {
    const result = triageOutputSchema.parse({ classification: 'conversa' });
    expect(result.items).toEqual([]);
  });

  it('rejeita item com type fora do vocabulário do domínio', () => {
    const result = triageOutputSchema.safeParse({
      classification: 'captura',
      items: [{ type: 'projeto', title: 'x' }],
    });
    expect(result.success).toBe(false);
  });
});

/**
 * Teste adversarial de prompt (RF-01, TESTING.md §4.1): o prompt nunca pode
 * instruir o modelo a perguntar estrutura. Não substitui teste de output
 * real do modelo (fora do escopo de unit test), mas garante que a regra
 * proibitiva está codificada no texto fixo enviado como system prompt —
 * regressão aqui pega alguém reescrevendo o prompt e afrouxando a regra.
 */
describe('prompt da triagem nunca instrui pergunta de estrutura', () => {
  const forbiddenQuestionWords = ['qual projeto', 'qual prazo', 'qual categoria', 'qual tag'];

  it('o prompt não contém nenhuma das perguntas proibidas', () => {
    const normalized = TRIAGE_SYSTEM_PROMPT.toLowerCase();
    for (const forbidden of forbiddenQuestionWords) {
      expect(normalized).not.toContain(forbidden);
    }
  });

  it('o prompt declara explicitamente a proibição de perguntar estrutura', () => {
    expect(TRIAGE_SYSTEM_PROMPT).toMatch(/nunca pergunte projeto, prazo, categoria ou tag/i);
  });

  it('o prompt instrui a nunca devolver uma pergunta em texto livre', () => {
    expect(TRIAGE_SYSTEM_PROMPT).toMatch(/nunca (uma pergunta|devolva uma pergunta)/i);
  });
});
