import type { Logger } from 'pino';
import { SttRequestError, type SttProvider, type SttTranscriptionRequest, type SttTranscriptionResult } from './provider.js';

export interface SttRouterConfig {
  /** `undefined` quando `GROQ_API_KEY` não está configurada — o router nem tenta o primário (spec item 1). */
  readonly primary: SttProvider | undefined;
  /** `undefined` quando `OPENAI_API_KEY` não está configurada — desativa só o fallback, nunca é erro de boot. */
  readonly fallback: SttProvider | undefined;
  readonly logger: Logger;
}

export type SttResult = { readonly kind: 'ok'; readonly text: string } | { readonly kind: 'error' };

/**
 * Seleção automática (spec item 1): tenta o primário; qualquer falha
 * tratada (rede, timeout, HTTP, corpo não-JSON) cai no fallback; falha dos
 * dois devolve erro tipado ao chamador — o tratamento de "falha total" é
 * responsabilidade do módulo `capture`, não desta camada.
 */
export class SttRouter {
  constructor(private readonly config: SttRouterConfig) {}

  async transcribe(request: SttTranscriptionRequest): Promise<SttResult> {
    if (this.config.primary) {
      const primaryResult = await this.tryProvider(this.config.primary, request);
      if (primaryResult) return { kind: 'ok', text: primaryResult.text };
    } else {
      this.config.logger.warn('STT primário (Groq) não configurado (GROQ_API_KEY ausente), tentando só o fallback');
    }

    if (this.config.fallback) {
      const fallbackResult = await this.tryProvider(this.config.fallback, request);
      if (fallbackResult) return { kind: 'ok', text: fallbackResult.text };
    }

    return { kind: 'error' };
  }

  private async tryProvider(
    provider: SttProvider,
    request: SttTranscriptionRequest,
  ): Promise<SttTranscriptionResult | undefined> {
    try {
      return await provider.transcribe(request);
    } catch (err) {
      if (err instanceof SttRequestError) {
        this.config.logger.warn({ err, provider: provider.name }, 'falha ao transcrever áudio, tentando próximo provedor');
        return undefined;
      }
      throw err;
    }
  }
}
