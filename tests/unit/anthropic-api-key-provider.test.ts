import { describe, expect, it, vi } from 'vitest';
import { AnthropicApiKeyProvider } from '../../src/core/llm/anthropic-api-key-provider.js';
import { LlmRequestError, LlmTimeoutError } from '../../src/core/llm/provider.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('AnthropicApiKeyProvider', () => {
  it('extrai tokens_in/tokens_out/cache_read_tokens da resposta', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(200, {
        content: [{ type: 'text', text: 'oi' }],
        usage: { input_tokens: 120, output_tokens: 30, cache_read_input_tokens: 90 },
      }),
    );
    const provider = new AnthropicApiKeyProvider({ apiKey: 'key', fetchFn: fetchFn as unknown as typeof fetch });

    const result = await provider.complete({
      model: 'claude-haiku-4-5-20251001',
      systemPrompt: 'sistema',
      messages: [{ role: 'user', content: 'oi' }],
      maxTokens: 100,
    });

    expect(result.usage).toEqual({ tokensIn: 120, tokensOut: 30, cacheReadTokens: 90 });
  });

  it('extrai tool_use blocks como toolCalls, incluindo o id (necessário para casar tool_result no loop)', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(200, {
        content: [
          { type: 'tool_use', id: 'toolu_1', name: 'submit_triage', input: { classification: 'conversa', items: [] } },
        ],
        usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 },
      }),
    );
    const provider = new AnthropicApiKeyProvider({ apiKey: 'key', fetchFn: fetchFn as unknown as typeof fetch });

    const result = await provider.complete({
      model: 'claude-haiku-4-5-20251001',
      systemPrompt: 'sistema',
      messages: [{ role: 'user', content: 'oi' }],
      maxTokens: 100,
    });

    expect(result.toolCalls).toEqual([
      { id: 'toolu_1', toolName: 'submit_triage', input: { classification: 'conversa', items: [] } },
    ]);
  });

  it('gera um id de fallback quando a resposta não traz um (defensivo — a API real sempre traz)', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(200, {
        content: [{ type: 'tool_use', name: 'submit_triage', input: { classification: 'conversa', items: [] } }],
        usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 },
      }),
    );
    const provider = new AnthropicApiKeyProvider({ apiKey: 'key', fetchFn: fetchFn as unknown as typeof fetch });

    const result = await provider.complete({
      model: 'claude-haiku-4-5-20251001',
      systemPrompt: 'sistema',
      messages: [{ role: 'user', content: 'oi' }],
      maxTokens: 100,
    });

    expect(result.toolCalls[0]?.id).toBe('tool_use_0');
  });

  it('marca o system prompt como cacheável quando cacheSystemPrompt=true (ADR-007)', async () => {
    const fetchFn = vi.fn(async (_url: string | URL, _init?: RequestInit) =>
      jsonResponse(200, { content: [{ type: 'text', text: 'oi' }], usage: {} }),
    );
    const provider = new AnthropicApiKeyProvider({ apiKey: 'key', fetchFn: fetchFn as unknown as typeof fetch });

    await provider.complete({
      model: 'claude-sonnet-4-5-20250929',
      systemPrompt: 'sistema estável',
      messages: [{ role: 'user', content: 'oi' }],
      maxTokens: 100,
      cacheSystemPrompt: true,
    });

    const body = JSON.parse(String(fetchFn.mock.calls[0]?.[1]?.body)) as { system: unknown };
    expect(body.system).toEqual([{ type: 'text', text: 'sistema estável', cache_control: { type: 'ephemeral' } }]);
  });

  it('sem cacheSystemPrompt, o system continua string simples (comportamento pré-FEAT-006, byte a byte)', async () => {
    const fetchFn = vi.fn(async (_url: string | URL, _init?: RequestInit) =>
      jsonResponse(200, { content: [{ type: 'text', text: 'oi' }], usage: {} }),
    );
    const provider = new AnthropicApiKeyProvider({ apiKey: 'key', fetchFn: fetchFn as unknown as typeof fetch });

    await provider.complete({
      model: 'claude-haiku-4-5-20251001',
      systemPrompt: 'sistema da triagem',
      messages: [{ role: 'user', content: 'oi' }],
      maxTokens: 100,
    });

    const body = JSON.parse(String(fetchFn.mock.calls[0]?.[1]?.body)) as { system: unknown };
    expect(body.system).toBe('sistema da triagem');
  });

  it('nunca inclui a api key em nenhum campo do corpo da requisição', async () => {
    const fetchFn = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      expect(init?.body).not.toContain('minha-chave-secreta');
      return jsonResponse(200, { content: [], usage: {} });
    });
    const provider = new AnthropicApiKeyProvider({
      apiKey: 'minha-chave-secreta',
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    await provider.complete({
      model: 'claude-haiku-4-5-20251001',
      systemPrompt: 'sistema',
      messages: [{ role: 'user', content: 'oi' }],
      maxTokens: 100,
    });

    expect(fetchFn).toHaveBeenCalled();
  });

  it('erro HTTP (não-2xx) vira LlmRequestError, não derruba o processo', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(500, { error: { message: 'internal error' } }));
    const provider = new AnthropicApiKeyProvider({ apiKey: 'key', fetchFn: fetchFn as unknown as typeof fetch });

    await expect(
      provider.complete({
        model: 'claude-haiku-4-5-20251001',
        systemPrompt: 'sistema',
        messages: [{ role: 'user', content: 'oi' }],
        maxTokens: 100,
      }),
    ).rejects.toThrow(LlmRequestError);
  });

  it('erro HTTP (502 de gateway) com corpo HTML não-JSON vira LlmRequestError, nunca SyntaxError', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response('<html><body>502 Bad Gateway</body></html>', {
          status: 502,
          headers: { 'Content-Type': 'text/html' },
        }),
    );
    const provider = new AnthropicApiKeyProvider({ apiKey: 'key', fetchFn: fetchFn as unknown as typeof fetch });

    await expect(
      provider.complete({
        model: 'claude-haiku-4-5-20251001',
        systemPrompt: 'sistema',
        messages: [{ role: 'user', content: 'oi' }],
        maxTokens: 100,
      }),
    ).rejects.toThrow(LlmRequestError);
  });

  it('resposta 2xx com corpo não-JSON vira LlmRequestError, nunca SyntaxError', async () => {
    const fetchFn = vi.fn(
      async () => new Response('não é json', { status: 200, headers: { 'Content-Type': 'text/plain' } }),
    );
    const provider = new AnthropicApiKeyProvider({ apiKey: 'key', fetchFn: fetchFn as unknown as typeof fetch });

    await expect(
      provider.complete({
        model: 'claude-haiku-4-5-20251001',
        systemPrompt: 'sistema',
        messages: [{ role: 'user', content: 'oi' }],
        maxTokens: 100,
      }),
    ).rejects.toThrow(LlmRequestError);
  });

  it('falha de rede vira LlmRequestError', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const provider = new AnthropicApiKeyProvider({ apiKey: 'key', fetchFn: fetchFn as unknown as typeof fetch });

    await expect(
      provider.complete({
        model: 'claude-haiku-4-5-20251001',
        systemPrompt: 'sistema',
        messages: [{ role: 'user', content: 'oi' }],
        maxTokens: 100,
      }),
    ).rejects.toThrow(LlmRequestError);
  });

  it('timeout vira LlmTimeoutError sem derrubar o processo', async () => {
    const fetchFn = vi.fn((_url: string | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });
    const provider = new AnthropicApiKeyProvider({
      apiKey: 'key',
      timeoutMs: 10,
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    await expect(
      provider.complete({
        model: 'claude-haiku-4-5-20251001',
        systemPrompt: 'sistema',
        messages: [{ role: 'user', content: 'oi' }],
        maxTokens: 100,
      }),
    ).rejects.toThrow(LlmTimeoutError);
  });
});
