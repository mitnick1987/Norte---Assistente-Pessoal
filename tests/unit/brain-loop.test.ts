import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { runBrainLoop, type BrainToolDefinition } from '../../src/core/llm/brain-loop.js';
import type { LlmCompletionResult, LlmProvider } from '../../src/core/llm/index.js';
import { createLogger } from '../../src/core/logger.js';

const logger = createLogger('test');

function buildProvider(complete: LlmProvider['complete']): LlmProvider {
  return { name: 'stub', complete };
}

function textResult(text: string): LlmCompletionResult {
  return { text, toolCalls: [], usage: { tokensIn: 1, tokensOut: 1, cacheReadTokens: 0 } };
}

function toolCallResult(id: string, toolName: string, input: unknown): LlmCompletionResult {
  return { text: undefined, toolCalls: [{ id, toolName, input }], usage: { tokensIn: 1, tokensOut: 1, cacheReadTokens: 0 } };
}

const echoToolSchema = z.object({ value: z.string() }).strict();
type EchoInput = z.infer<typeof echoToolSchema>;

function buildEchoTool(handler?: (input: EchoInput) => Promise<unknown>): BrainToolDefinition {
  const tool: BrainToolDefinition<EchoInput> = {
    name: 'echo',
    description: 'devolve o valor recebido',
    inputSchema: echoToolSchema,
    handler: handler ?? (async (input) => ({ echoed: input.value })),
  };
  return tool as unknown as BrainToolDefinition;
}

describe('runBrainLoop (ADR-001, loop de tool-use manual)', () => {
  it('modelo pede uma tool válida, handler executa, resultado volta como tool_result e o modelo responde em texto', async () => {
    const complete = vi
      .fn<LlmProvider['complete']>()
      .mockResolvedValueOnce(toolCallResult('t1', 'echo', { value: 'oi' }))
      .mockResolvedValueOnce(textResult('resposta final'));
    const provider = buildProvider(complete);

    const result = await runBrainLoop(
      { provider, tools: [buildEchoTool()], logger },
      { model: 'm', systemPrompt: 'sys', messages: [{ role: 'user', content: 'oi' }], maxTokens: 100 },
    );

    expect(result.text).toBe('resposta final');
    expect(complete).toHaveBeenCalledTimes(2);

    // segunda chamada carrega o tool_result casado pelo id da primeira
    const secondCallMessages = complete.mock.calls[1]![0].messages;
    const toolResultMessage = secondCallMessages[secondCallMessages.length - 1]!;
    expect(toolResultMessage.role).toBe('user');
    expect(toolResultMessage.content).toEqual([{ type: 'tool_result', toolUseId: 't1', content: JSON.stringify({ echoed: 'oi' }) }]);
  });

  it('tool inexistente no registry nunca chega a um handler — erro estruturado devolvido ao modelo', async () => {
    const handler = vi.fn();
    const complete = vi
      .fn<LlmProvider['complete']>()
      .mockResolvedValueOnce(toolCallResult('t1', 'tool_que_nao_existe', {}))
      .mockResolvedValueOnce(textResult('não consegui'));
    const provider = buildProvider(complete);

    const result = await runBrainLoop(
      { provider, tools: [buildEchoTool(handler)], logger },
      { model: 'm', systemPrompt: 'sys', messages: [], maxTokens: 100 },
    );

    expect(handler).not.toHaveBeenCalled();
    expect(result.text).toBe('não consegui');

    const secondCallMessages = complete.mock.calls[1]![0].messages;
    const toolResultMessage = secondCallMessages[secondCallMessages.length - 1]!;
    expect(toolResultMessage.content).toEqual([
      { type: 'tool_result', toolUseId: 't1', content: 'essa ferramenta não existe.', isError: true },
    ]);
  });

  it('input que falha o inputSchema.parse nunca chega ao handler — mesmo comportamento de erro estruturado', async () => {
    const handler = vi.fn();
    const complete = vi
      .fn<LlmProvider['complete']>()
      .mockResolvedValueOnce(toolCallResult('t1', 'echo', { value: 123 }))
      .mockResolvedValueOnce(textResult('tentando de novo'));
    const provider = buildProvider(complete);

    const result = await runBrainLoop(
      { provider, tools: [buildEchoTool(handler)], logger },
      { model: 'm', systemPrompt: 'sys', messages: [], maxTokens: 100 },
    );

    expect(handler).not.toHaveBeenCalled();
    expect(result.text).toBe('tentando de novo');

    const secondCallMessages = complete.mock.calls[1]![0].messages;
    const toolResultMessage = secondCallMessages[secondCallMessages.length - 1]!;
    expect(toolResultMessage.content).toEqual([
      { type: 'tool_result', toolUseId: 't1', content: 'entrada inválida para essa ferramenta.', isError: true },
    ]);
  });

  it('erro no handler nunca vaza detalhe interno — vira tool_result de erro genérico', async () => {
    const handler = vi.fn(async () => {
      throw new Error('SQLITE_CONSTRAINT: UNIQUE em tabela items, coluna secreta');
    });
    const complete = vi
      .fn<LlmProvider['complete']>()
      .mockResolvedValueOnce(toolCallResult('t1', 'echo', { value: 'oi' }))
      .mockResolvedValueOnce(textResult('falhou'));
    const provider = buildProvider(complete);

    const result = await runBrainLoop(
      { provider, tools: [buildEchoTool(handler)], logger },
      { model: 'm', systemPrompt: 'sys', messages: [], maxTokens: 100 },
    );

    expect(result.text).toBe('falhou');
    const secondCallMessages = complete.mock.calls[1]![0].messages;
    const toolResultMessage = secondCallMessages[secondCallMessages.length - 1]!;
    const content = JSON.stringify(toolResultMessage.content);
    expect(content).not.toContain('SQLITE_CONSTRAINT');
    expect(content).not.toContain('items');
    expect(toolResultMessage.content).toEqual([
      { type: 'tool_result', toolUseId: 't1', content: 'falha ao executar essa ferramenta agora.', isError: true },
    ]);
  });

  it('erro no handler é logado só com a mensagem, nunca o objeto de erro bruto (evita vazar corpo de requisição de libs externas)', async () => {
    const sensitiveError = new Error('falha de rede') as Error & { config?: unknown };
    sensitiveError.config = { headers: { Authorization: 'Bearer segredo-nao-pode-vazar' } };
    const handler = vi.fn(async () => {
      throw sensitiveError;
    });
    const complete = vi
      .fn<LlmProvider['complete']>()
      .mockResolvedValueOnce(toolCallResult('t1', 'echo', { value: 'oi' }))
      .mockResolvedValueOnce(textResult('falhou'));
    const provider = buildProvider(complete);
    const errorSpy = vi.fn();
    const spyLogger = { ...logger, error: errorSpy };

    await runBrainLoop(
      { provider, tools: [buildEchoTool(handler)], logger: spyLogger },
      { model: 'm', systemPrompt: 'sys', messages: [], maxTokens: 100 },
    );

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const loggedPayload = errorSpy.mock.calls[0]![0] as Record<string, unknown>;
    expect(loggedPayload['message']).toBe('falha de rede');
    expect(JSON.stringify(loggedPayload)).not.toContain('segredo-nao-pode-vazar');
  });

  it('múltiplas tools em sequência num mesmo turno são resolvidas uma a uma', async () => {
    const handler = vi.fn(async (input: { value: string }) => ({ echoed: input.value }));
    const complete = vi
      .fn<LlmProvider['complete']>()
      .mockResolvedValueOnce({
        text: undefined,
        toolCalls: [
          { id: 't1', toolName: 'echo', input: { value: 'a' } },
          { id: 't2', toolName: 'echo', input: { value: 'b' } },
        ],
        usage: { tokensIn: 1, tokensOut: 1, cacheReadTokens: 0 },
      })
      .mockResolvedValueOnce(textResult('ambas resolvidas'));
    const provider = buildProvider(complete);

    const result = await runBrainLoop(
      { provider, tools: [buildEchoTool(handler)], logger },
      { model: 'm', systemPrompt: 'sys', messages: [], maxTokens: 100 },
    );

    expect(handler).toHaveBeenCalledTimes(2);
    expect(result.text).toBe('ambas resolvidas');

    const secondCallMessages = complete.mock.calls[1]![0].messages;
    const toolResultMessage = secondCallMessages[secondCallMessages.length - 1]!;
    expect(toolResultMessage.content).toEqual([
      { type: 'tool_result', toolUseId: 't1', content: JSON.stringify({ echoed: 'a' }) },
      { type: 'tool_result', toolUseId: 't2', content: JSON.stringify({ echoed: 'b' }) },
    ]);
  });

  it('teto de iterações atingido devolve resposta padrão de fallback, nunca trava a requisição', async () => {
    const complete = vi.fn<LlmProvider['complete']>(async () => toolCallResult('t1', 'echo', { value: 'de novo' }));
    const provider = buildProvider(complete);

    const result = await runBrainLoop(
      { provider, tools: [buildEchoTool()], logger },
      { model: 'm', systemPrompt: 'sys', messages: [], maxTokens: 100 },
    );

    expect(result.text).toContain('não consegui');
    // teto fixo de iterações (constante de código) — nunca chama além disso.
    expect(complete.mock.calls.length).toBeLessThanOrEqual(6);
  });

  it('registra usage a cada chamada de completude (custo, RF-15)', async () => {
    const onUsage = vi.fn();
    const complete = vi
      .fn<LlmProvider['complete']>()
      .mockResolvedValueOnce(toolCallResult('t1', 'echo', { value: 'oi' }))
      .mockResolvedValueOnce(textResult('fim'));
    const provider = buildProvider(complete);

    await runBrainLoop({ provider, tools: [buildEchoTool()], logger, onUsage }, {
      model: 'm',
      systemPrompt: 'sys',
      messages: [],
      maxTokens: 100,
    });

    expect(onUsage).toHaveBeenCalledTimes(2);
  });

  it('sempre chama o provider com cacheSystemPrompt=true (ADR-007)', async () => {
    const complete = vi.fn<LlmProvider['complete']>(async () => textResult('oi'));
    const provider = buildProvider(complete);

    await runBrainLoop({ provider, tools: [], logger }, { model: 'm', systemPrompt: 'sys', messages: [], maxTokens: 100 });

    expect(complete.mock.calls[0]![0].cacheSystemPrompt).toBe(true);
  });
});
