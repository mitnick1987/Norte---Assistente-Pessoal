import { describe, expect, it } from 'vitest';
import { buildBrainSystemPrompt, formatCurrentDateTimeForPrompt, TONE_RULES_BLOCK } from '../../src/core/llm/index.js';
import type { PromptFragmentSource } from '../../src/core/llm/index.js';

/**
 * Suite byte-estável (ADR-007, spec FEAT-006 item 3): a montagem do system
 * prompt precisa produzir a sequência de bytes idêntica entre chamadas para
 * o cache da Anthropic valer a pena — qualquer diferença invalida o cache
 * silenciosamente (o risco mais citado no PRD para descontrole de custo).
 */
describe('buildBrainSystemPrompt (byte-estável, ADR-007)', () => {
  const moduleA: PromptFragmentSource = { name: 'aaa', promptFragment: () => 'fragmento A' };
  const moduleB: PromptFragmentSource = { name: 'bbb', promptFragment: () => 'fragmento B' };
  const moduleWithoutFragment: PromptFragmentSource = { name: 'ccc' };

  it('mesmo conjunto de módulos produz bytes idênticos entre duas montagens', () => {
    const first = buildBrainSystemPrompt([moduleA, moduleB]);
    const second = buildBrainSystemPrompt([moduleA, moduleB]);

    expect(first).toBe(second);
  });

  it('ordem determinística por nome de módulo, independente da ordem de entrada', () => {
    const orderedAB = buildBrainSystemPrompt([moduleA, moduleB]);
    const orderedBA = buildBrainSystemPrompt([moduleB, moduleA]);

    expect(orderedAB).toBe(orderedBA);
    expect(orderedAB.indexOf('fragmento A')).toBeLessThan(orderedAB.indexOf('fragmento B'));
  });

  it('módulo sem promptFragment não quebra a montagem nem insere lixo', () => {
    const prompt = buildBrainSystemPrompt([moduleA, moduleWithoutFragment, moduleB]);

    expect(prompt).toContain('fragmento A');
    expect(prompt).toContain('fragmento B');
  });

  it('bloco de regras de tom está sempre presente e idêntico entre montagens', () => {
    const withModules = buildBrainSystemPrompt([moduleA]);
    const withoutModules = buildBrainSystemPrompt([]);

    expect(withModules).toContain(TONE_RULES_BLOCK);
    expect(withoutModules).toContain(TONE_RULES_BLOCK);
  });

  it('bloco de tom vem sempre por último, depois de todos os fragmentos', () => {
    const prompt = buildBrainSystemPrompt([moduleA, moduleB]);

    expect(prompt.indexOf('fragmento B')).toBeLessThan(prompt.indexOf(TONE_RULES_BLOCK));
  });

  it('nunca contém data/hora — isso é responsabilidade exclusiva da última mensagem do usuário', () => {
    const prompt = buildBrainSystemPrompt([moduleA, moduleB]);

    expect(prompt).not.toMatch(/\d{2}\/\d{2}\/\d{4}/);
  });
});

describe('formatCurrentDateTimeForPrompt — só entra na mensagem do usuário, nunca no system prompt', () => {
  it('muda quando a hora corrente muda, mas isso nunca afeta o system prompt (ver suite acima)', () => {
    const morning = formatCurrentDateTimeForPrompt({ year: 2026, month: 8, day: 30, hour: 7, minute: 40 });
    const night = formatCurrentDateTimeForPrompt({ year: 2026, month: 8, day: 30, hour: 21, minute: 30 });

    expect(morning).not.toBe(night);
    expect(morning).toContain('30/08/2026');
    expect(morning).toContain('07:40');
    expect(night).toContain('21:30');
  });

  it('formata o dia da semana em português', () => {
    // 30/08/2026 é um domingo.
    const formatted = formatCurrentDateTimeForPrompt({ year: 2026, month: 8, day: 30, hour: 12, minute: 0 });

    expect(formatted.toLowerCase()).toContain('domingo');
  });
});
