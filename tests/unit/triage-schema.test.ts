import { describe, expect, it } from 'vitest';
import { triageOutputSchema } from '../../src/modules/capture/domain/triage-schema.js';
import { buildTriageSystemPrompt } from '../../src/modules/capture/domain/triage-prompt.js';

const REFERENCE_NOW = new Date('2026-08-25T13:00:00.000Z');

describe('schema de saída da triagem (round-trip)', () => {
  it('aceita captura com múltiplos itens, alguns com dueExpression', () => {
    const input = {
      classification: 'captura',
      items: [
        { type: 'tarefa', title: 'pagar boleto', dueExpression: 'sexta 14h' },
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
    const normalized = buildTriageSystemPrompt(REFERENCE_NOW).toLowerCase();
    for (const forbidden of forbiddenQuestionWords) {
      expect(normalized).not.toContain(forbidden);
    }
  });

  it('o prompt declara explicitamente a proibição de perguntar estrutura', () => {
    expect(buildTriageSystemPrompt(REFERENCE_NOW)).toMatch(/nunca pergunte projeto, prazo, categoria ou tag/i);
  });

  it('o prompt instrui a nunca devolver uma pergunta em texto livre', () => {
    expect(buildTriageSystemPrompt(REFERENCE_NOW)).toMatch(/nunca (uma pergunta|devolva uma pergunta)/i);
  });
});

/**
 * ADR-006 (bloqueante do review de FEAT-002): o Haiku nunca deve calcular
 * data absoluta — ele não tem como saber o dia de hoje sem alucinar. O
 * prompt instrui a devolver a expressão relativa como o usuário disse, e
 * carrega a data/hora atual só como contexto auxiliar, não como cálculo.
 */
describe('prompt da triagem nunca pede data absoluta ao modelo', () => {
  it('pede dueExpression (expressão relativa), nunca dueAt/ISO absoluto', () => {
    const prompt = buildTriageSystemPrompt(REFERENCE_NOW);
    expect(prompt).toMatch(/dueExpression/);
    expect(prompt.toLowerCase()).not.toContain('dueat');
    expect(prompt.toLowerCase()).not.toContain('iso 8601');
  });

  it('injeta a data e hora atuais de America/Sao_Paulo como contexto', () => {
    // REFERENCE_NOW = 2026-08-25T13:00:00.000Z = terça-feira 10:00 em America/Sao_Paulo.
    const prompt = buildTriageSystemPrompt(REFERENCE_NOW);
    expect(prompt).toContain('terça-feira, 25/08/2026 10:00');
  });

  it('instrui explicitamente a não calcular/converter a data', () => {
    expect(buildTriageSystemPrompt(REFERENCE_NOW).toLowerCase()).toMatch(/nunca calcule ou converta a data/);
  });
});
