import { describe, expect, it, vi } from 'vitest';
import { OpenAiWhisperProvider } from '../../src/core/stt/openai-whisper-provider.js';
import { SttRequestError, SttTimeoutError } from '../../src/core/stt/provider.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('OpenAiWhisperProvider (fallback, ADR-017)', () => {
  it('extrai o texto transcrito da resposta', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, { text: 'marcar dentista sexta' }));
    const provider = new OpenAiWhisperProvider({ apiKey: 'key', fetchFn: fetchFn as unknown as typeof fetch });

    const result = await provider.transcribe({ audioBase64: 'QUFB', mimeType: 'audio/ogg' });

    expect(result.text).toBe('marcar dentista sexta');
  });

  it('nunca inclui a api key em nenhum campo do corpo, só no header Authorization', async () => {
    const fetchFn = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer chave-openai-secreta');
      return jsonResponse(200, { text: 'oi' });
    });
    const provider = new OpenAiWhisperProvider({ apiKey: 'chave-openai-secreta', fetchFn: fetchFn as unknown as typeof fetch });

    await provider.transcribe({ audioBase64: 'QUFB', mimeType: 'audio/ogg' });

    expect(fetchFn).toHaveBeenCalled();
  });

  it('erro HTTP (4xx/5xx) vira SttRequestError', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(500, { error: { message: 'internal error' } }));
    const provider = new OpenAiWhisperProvider({ apiKey: 'key', fetchFn: fetchFn as unknown as typeof fetch });

    await expect(provider.transcribe({ audioBase64: 'QUFB', mimeType: 'audio/ogg' })).rejects.toThrow(SttRequestError);
  });

  it('corpo de resposta não-JSON vira SttRequestError, nunca SyntaxError', async () => {
    const fetchFn = vi.fn(
      async () => new Response('<html>502 Bad Gateway</html>', { status: 502, headers: { 'Content-Type': 'text/html' } }),
    );
    const provider = new OpenAiWhisperProvider({ apiKey: 'key', fetchFn: fetchFn as unknown as typeof fetch });

    await expect(provider.transcribe({ audioBase64: 'QUFB', mimeType: 'audio/ogg' })).rejects.toThrow(SttRequestError);
  });

  it('falha de rede vira SttRequestError', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const provider = new OpenAiWhisperProvider({ apiKey: 'key', fetchFn: fetchFn as unknown as typeof fetch });

    await expect(provider.transcribe({ audioBase64: 'QUFB', mimeType: 'audio/ogg' })).rejects.toThrow(SttRequestError);
  });

  it('timeout vira SttTimeoutError sem derrubar o processo', async () => {
    const fetchFn = vi.fn((_url: string | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    });
    const provider = new OpenAiWhisperProvider({ apiKey: 'key', timeoutMs: 10, fetchFn: fetchFn as unknown as typeof fetch });

    await expect(provider.transcribe({ audioBase64: 'QUFB', mimeType: 'audio/ogg' })).rejects.toThrow(SttTimeoutError);
  });
});
