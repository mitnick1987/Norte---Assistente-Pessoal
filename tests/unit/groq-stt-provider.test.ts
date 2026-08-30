import { describe, expect, it, vi } from 'vitest';
import { GroqSttProvider } from '../../src/core/stt/groq-provider.js';
import { SttRequestError, SttTimeoutError } from '../../src/core/stt/provider.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('GroqSttProvider', () => {
  it('extrai o texto transcrito da resposta', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, { text: 'lembra de comprar ração amanhã' }));
    const provider = new GroqSttProvider({ apiKey: 'key', fetchFn: fetchFn as unknown as typeof fetch });

    const result = await provider.transcribe({ audioBase64: 'QUFB', mimeType: 'audio/ogg' });

    expect(result.text).toBe('lembra de comprar ração amanhã');
  });

  it('envia a api key só no header Authorization, nunca no corpo', async () => {
    const fetchFn = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer minha-chave-secreta');
      return jsonResponse(200, { text: 'oi' });
    });
    const provider = new GroqSttProvider({ apiKey: 'minha-chave-secreta', fetchFn: fetchFn as unknown as typeof fetch });

    await provider.transcribe({ audioBase64: 'QUFB', mimeType: 'audio/ogg' });

    expect(fetchFn).toHaveBeenCalled();
  });

  it('anexa o áudio com filename com extensão correta (Groq infere formato pela extensão, não pelo Content-Type)', async () => {
    let sentFile: File | undefined;
    const fetchFn = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const form = init?.body as FormData;
      sentFile = form.get('file') as File;
      return jsonResponse(200, { text: 'oi' });
    });
    const provider = new GroqSttProvider({ apiKey: 'key', fetchFn: fetchFn as unknown as typeof fetch });

    await provider.transcribe({ audioBase64: 'QUFB', mimeType: 'audio/ogg; codecs=opus' });

    expect(sentFile).toBeDefined();
    expect(sentFile!.name).toBe('audio.ogg');
  });

  it.each([
    ['audio/ogg', 'audio.ogg'],
    ['audio/mpeg', 'audio.mp3'],
    ['audio/mp4', 'audio.m4a'],
    ['audio/wav', 'audio.wav'],
    ['audio/webm', 'audio.webm'],
  ])('filename enviado para mimeType %s é %s', async (mimeType, expectedFilename) => {
    let sentFile: File | undefined;
    const fetchFn = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      const form = init?.body as FormData;
      sentFile = form.get('file') as File;
      return jsonResponse(200, { text: 'oi' });
    });
    const provider = new GroqSttProvider({ apiKey: 'key', fetchFn: fetchFn as unknown as typeof fetch });

    await provider.transcribe({ audioBase64: 'QUFB', mimeType });

    expect(sentFile!.name).toBe(expectedFilename);
  });

  it('erro HTTP (4xx/5xx) vira SttRequestError, não derruba o processo', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(500, { error: { message: 'internal error' } }));
    const provider = new GroqSttProvider({ apiKey: 'key', fetchFn: fetchFn as unknown as typeof fetch });

    await expect(provider.transcribe({ audioBase64: 'QUFB', mimeType: 'audio/ogg' })).rejects.toThrow(SttRequestError);
  });

  it('erro HTTP sem corpo de erro estruturado ainda vira SttRequestError com mensagem genérica', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(503, {}));
    const provider = new GroqSttProvider({ apiKey: 'key', fetchFn: fetchFn as unknown as typeof fetch });

    await expect(provider.transcribe({ audioBase64: 'QUFB', mimeType: 'audio/ogg' })).rejects.toThrow(/erro desconhecido/);
  });

  it('corpo de resposta não-JSON vira SttRequestError, nunca SyntaxError', async () => {
    const fetchFn = vi.fn(
      async () => new Response('<html>502 Bad Gateway</html>', { status: 502, headers: { 'Content-Type': 'text/html' } }),
    );
    const provider = new GroqSttProvider({ apiKey: 'key', fetchFn: fetchFn as unknown as typeof fetch });

    await expect(provider.transcribe({ audioBase64: 'QUFB', mimeType: 'audio/ogg' })).rejects.toThrow(SttRequestError);
  });

  it('resposta 2xx sem o campo "text" vira SttRequestError', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, {}));
    const provider = new GroqSttProvider({ apiKey: 'key', fetchFn: fetchFn as unknown as typeof fetch });

    await expect(provider.transcribe({ audioBase64: 'QUFB', mimeType: 'audio/ogg' })).rejects.toThrow(SttRequestError);
  });

  it('falha de rede vira SttRequestError', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    const provider = new GroqSttProvider({ apiKey: 'key', fetchFn: fetchFn as unknown as typeof fetch });

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
    const provider = new GroqSttProvider({ apiKey: 'key', timeoutMs: 10, fetchFn: fetchFn as unknown as typeof fetch });

    await expect(provider.transcribe({ audioBase64: 'QUFB', mimeType: 'audio/ogg' })).rejects.toThrow(SttTimeoutError);
  });
});
