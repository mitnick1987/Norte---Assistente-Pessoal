import { describe, expect, it } from 'vitest';
import { SttRouter } from '../../src/core/stt/stt-router.js';
import { SttRequestError, SttTimeoutError, type SttProvider } from '../../src/core/stt/provider.js';
import { createLogger } from '../../src/core/logger.js';

const logger = createLogger('test');

function stubProvider(name: string, behavior: () => Promise<{ text: string }>): SttProvider {
  return { name, transcribe: behavior };
}

describe('SttRouter (seleção automática com fallback, spec FEAT-003 item 1)', () => {
  it('sucesso do primário nunca aciona o secundário (sem chamada dupla)', async () => {
    let fallbackCalls = 0;
    const primary = stubProvider('groq', async () => ({ text: 'transcrito pelo primário' }));
    const fallback = stubProvider('openai-whisper', async () => {
      fallbackCalls++;
      return { text: 'nao deveria chegar aqui' };
    });
    const router = new SttRouter({ primary, fallback, logger });

    const result = await router.transcribe({ audioBase64: 'QUFB', mimeType: 'audio/ogg' });

    expect(result).toEqual({ kind: 'ok', text: 'transcrito pelo primário' });
    expect(fallbackCalls).toBe(0);
  });

  it('falha do primário aciona automaticamente o fallback', async () => {
    const primary = stubProvider('groq', async () => {
      throw new SttRequestError('falha simulada do primário');
    });
    const fallback = stubProvider('openai-whisper', async () => ({ text: 'transcrito pelo fallback' }));
    const router = new SttRouter({ primary, fallback, logger });

    const result = await router.transcribe({ audioBase64: 'QUFB', mimeType: 'audio/ogg' });

    expect(result).toEqual({ kind: 'ok', text: 'transcrito pelo fallback' });
  });

  it('timeout do primário é tratado como falha e também aciona o fallback', async () => {
    const primary = stubProvider('groq', async () => {
      throw new SttTimeoutError(15_000);
    });
    const fallback = stubProvider('openai-whisper', async () => ({ text: 'transcrito pelo fallback' }));
    const router = new SttRouter({ primary, fallback, logger });

    const result = await router.transcribe({ audioBase64: 'QUFB', mimeType: 'audio/ogg' });

    expect(result).toEqual({ kind: 'ok', text: 'transcrito pelo fallback' });
  });

  it('falha dos dois devolve erro tipado ao chamador, nunca lança exceção', async () => {
    const primary = stubProvider('groq', async () => {
      throw new SttRequestError('falha do primário');
    });
    const fallback = stubProvider('openai-whisper', async () => {
      throw new SttRequestError('falha do fallback');
    });
    const router = new SttRouter({ primary, fallback, logger });

    const result = await router.transcribe({ audioBase64: 'QUFB', mimeType: 'audio/ogg' });

    expect(result).toEqual({ kind: 'error' });
  });

  it('primário ausente (GROQ_API_KEY não configurada) pula direto para o fallback', async () => {
    const fallback = stubProvider('openai-whisper', async () => ({ text: 'transcrito só pelo fallback' }));
    const router = new SttRouter({ primary: undefined, fallback, logger });

    const result = await router.transcribe({ audioBase64: 'QUFB', mimeType: 'audio/ogg' });

    expect(result).toEqual({ kind: 'ok', text: 'transcrito só pelo fallback' });
  });

  it('nem primário nem fallback configurados devolve erro tipado, sem exceção', async () => {
    const router = new SttRouter({ primary: undefined, fallback: undefined, logger });

    const result = await router.transcribe({ audioBase64: 'QUFB', mimeType: 'audio/ogg' });

    expect(result).toEqual({ kind: 'error' });
  });

  it('erro não tratado (não é SttRequestError) propaga em vez de ser engolido', async () => {
    const primary = stubProvider('groq', async () => {
      throw new Error('bug inesperado, não é erro de STT');
    });
    const router = new SttRouter({ primary, fallback: undefined, logger });

    await expect(router.transcribe({ audioBase64: 'QUFB', mimeType: 'audio/ogg' })).rejects.toThrow(
      'bug inesperado, não é erro de STT',
    );
  });
});
