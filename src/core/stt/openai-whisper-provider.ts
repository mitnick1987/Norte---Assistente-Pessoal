import { SttRequestError, SttTimeoutError, type SttProvider, type SttTranscriptionRequest, type SttTranscriptionResult } from './provider.js';
import { bufferFromBase64, parseTranscriptionResponse } from './groq-provider.js';

const OPENAI_API_URL = 'https://api.openai.com/v1/audio/transcriptions';
const OPENAI_MODEL = 'whisper-1';

export interface OpenAiWhisperProviderConfig {
  readonly apiKey: string;
  readonly timeoutMs?: number;
  /** Injetável para teste — nunca fetch global real no caminho testado (TESTING.md §7). */
  readonly fetchFn?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Fallback (spec item 1): só entra quando o primário (Groq) falha. Rede de
 * segurança de orçamento/latência, não caminho padrão — ver ADR-017 para o
 * mesmo raciocínio aplicado a `core/llm`.
 */
export class OpenAiWhisperProvider implements SttProvider {
  readonly name = 'openai-whisper';

  constructor(private readonly config: OpenAiWhisperProviderConfig) {}

  async transcribe(request: SttTranscriptionRequest): Promise<SttTranscriptionResult> {
    const doFetch = this.config.fetchFn ?? fetch;
    const timeoutMs = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const form = new FormData();
    form.append('model', OPENAI_MODEL);
    form.append('file', bufferFromBase64(request.audioBase64, request.mimeType));

    let response: Response;
    try {
      response = await doFetch(OPENAI_API_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
        body: form,
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new SttTimeoutError(timeoutMs);
      }
      throw new SttRequestError('falha de rede ao chamar a API da OpenAI', err);
    } finally {
      clearTimeout(timer);
    }

    return parseTranscriptionResponse(response, 'OpenAI');
  }
}
