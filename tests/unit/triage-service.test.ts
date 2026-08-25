import { describe, expect, it, vi } from 'vitest';
import { TriageService } from '../../src/modules/capture/triage-service.js';
import { LlmRequestError } from '../../src/core/llm/index.js';
import type { LlmProvider } from '../../src/core/llm/index.js';
import { createLogger } from '../../src/core/logger.js';

const logger = createLogger('test');

function buildProvider(complete: LlmProvider['complete']): LlmProvider {
  return { name: 'stub', complete };
}

describe('TriageService (round-trip do schema de triagem)', () => {
  it('classifica captura e retorna itens parseados', async () => {
    const onUsage = vi.fn();
    const provider = buildProvider(async () => ({
      text: undefined,
      toolCalls: [
        {
          toolName: 'submit_triage',
          input: { classification: 'captura', items: [{ type: 'tarefa', title: 'pagar boleto' }] },
        },
      ],
      usage: { tokensIn: 10, tokensOut: 5, cacheReadTokens: 0 },
    }));
    const service = new TriageService({ provider, logger, onUsage });

    const result = await service.classify('lembra de pagar o boleto');

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.output.classification).toBe('captura');
      expect(result.output.items).toEqual([{ type: 'tarefa', title: 'pagar boleto' }]);
    }
    expect(onUsage).toHaveBeenCalledWith({ tokensIn: 10, tokensOut: 5, cacheReadTokens: 0 });
  });

  it('classificação ambígua cai em item com ambiguous=true, nunca em pergunta', async () => {
    const provider = buildProvider(async () => ({
      text: undefined,
      toolCalls: [
        {
          toolName: 'submit_triage',
          input: { classification: 'captura', items: [{ type: 'nota', title: 'algo incerto', ambiguous: true }] },
        },
      ],
      usage: { tokensIn: 10, tokensOut: 5, cacheReadTokens: 0 },
    }));
    const service = new TriageService({ provider, logger, onUsage: vi.fn() });

    const result = await service.classify('sei lá, alguma coisa');

    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.output.items[0]?.ambiguous).toBe(true);
    }
  });

  it('erro do provedor vira { kind: "error" }, nunca propaga exceção', async () => {
    const provider = buildProvider(async () => {
      throw new LlmRequestError('falha simulada');
    });
    const service = new TriageService({ provider, logger, onUsage: vi.fn() });

    const result = await service.classify('qualquer coisa');

    expect(result.kind).toBe('error');
  });

  it('saída fora do schema (tool call malformada) vira { kind: "error" }', async () => {
    const provider = buildProvider(async () => ({
      text: undefined,
      toolCalls: [{ toolName: 'submit_triage', input: { classification: 'inválida-fora-do-enum' } }],
      usage: { tokensIn: 1, tokensOut: 1, cacheReadTokens: 0 },
    }));
    const service = new TriageService({ provider, logger, onUsage: vi.fn() });

    const result = await service.classify('qualquer coisa');

    expect(result.kind).toBe('error');
  });

  it('resposta sem nenhuma tool call vira { kind: "error" }', async () => {
    const provider = buildProvider(async () => ({
      text: 'não vou chamar a tool',
      toolCalls: [],
      usage: { tokensIn: 1, tokensOut: 1, cacheReadTokens: 0 },
    }));
    const service = new TriageService({ provider, logger, onUsage: vi.fn() });

    const result = await service.classify('qualquer coisa');

    expect(result.kind).toBe('error');
  });

  it('erro que não é LlmRequestError propaga (bug de programação não deve ser engolido)', async () => {
    const provider = buildProvider(async () => {
      throw new TypeError('bug interno');
    });
    const service = new TriageService({ provider, logger, onUsage: vi.fn() });

    await expect(service.classify('qualquer coisa')).rejects.toThrow(TypeError);
  });
});
