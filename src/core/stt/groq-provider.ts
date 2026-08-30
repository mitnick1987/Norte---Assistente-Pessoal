import type { Logger } from 'pino';
import { SttRequestError, SttTimeoutError, type SttProvider, type SttTranscriptionRequest, type SttTranscriptionResult } from './provider.js';
import { extFromMime } from './mime.js';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GROQ_MODEL = 'whisper-large-v3-turbo';

export interface GroqSttProviderConfig {
  readonly apiKey: string;
  readonly timeoutMs?: number;
  readonly logger?: Logger;
  /** Injetável para teste — nunca fetch global real no caminho testado (TESTING.md §7). */
  readonly fetchFn?: typeof fetch;
}

interface GroqTranscriptionBody {
  readonly text?: string;
  readonly error?: { readonly message?: string };
}

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Primário (spec item 1): endpoint OpenAI-compatible da Groq, mesmo
 * `whisper-large-v3-turbo` citado no PRD/ARCHITECTURE — mais barato e mais
 * rápido que a OpenAI para esse modelo. `apiKey` nunca aparece em log
 * (SECURITY.md §4) nem em nenhum campo do corpo, só no header Authorization.
 */
export class GroqSttProvider implements SttProvider {
  readonly name = 'groq';

  constructor(private readonly config: GroqSttProviderConfig) {}

  async transcribe(request: SttTranscriptionRequest): Promise<SttTranscriptionResult> {
    const doFetch = this.config.fetchFn ?? fetch;
    const timeoutMs = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const form = new FormData();
    form.append('model', GROQ_MODEL);
    const ext = extFromMime(request.mimeType, this.config.logger);
    form.append('file', bufferFromBase64(request.audioBase64, request.mimeType), `audio.${ext}`);

    let response: Response;
    try {
      response = await doFetch(GROQ_API_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
        body: form,
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new SttTimeoutError(timeoutMs);
      }
      throw new SttRequestError('falha de rede ao chamar a API da Groq', err);
    } finally {
      clearTimeout(timer);
    }

    return parseTranscriptionResponse(response, 'Groq');
  }
}

/**
 * Gateway/proxy intermediário pode responder erro com corpo HTML/texto em
 * vez de JSON — `response.json()` lançaria SyntaxError, que escaparia do
 * tratamento de erro tipado (mesmo endurecimento do `AnthropicApiKeyProvider`).
 */
export async function parseTranscriptionResponse(response: Response, providerLabel: string): Promise<SttTranscriptionResult> {
  let body: GroqTranscriptionBody;
  try {
    body = (await response.json()) as GroqTranscriptionBody;
  } catch (err) {
    throw new SttRequestError(`API da ${providerLabel} respondeu ${response.status} com corpo não-JSON`, err);
  }

  if (!response.ok) {
    throw new SttRequestError(`API da ${providerLabel} respondeu ${response.status}: ${body.error?.message ?? 'erro desconhecido'}`);
  }

  if (typeof body.text !== 'string') {
    throw new SttRequestError(`API da ${providerLabel} respondeu sem o campo "text"`);
  }

  return { text: body.text };
}

export function bufferFromBase64(base64: string, mimeType: string): Blob {
  return new Blob([Buffer.from(base64, 'base64')], { type: mimeType });
}
