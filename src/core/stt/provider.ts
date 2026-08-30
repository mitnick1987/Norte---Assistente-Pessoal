/**
 * Contrato de provedor de transcrição plugável (spec FEAT-003, mesmo
 * desenho do `core/llm`, ADR-017): `groq` é o primário, `openai-whisper` o
 * fallback — nenhum call-site conhece qual dos dois respondeu.
 */

export interface SttTranscriptionRequest {
  /** Áudio já em base64 — vem de `getBase64FromMediaMessage`, nunca do payload do webhook (SECURITY.md §6). */
  readonly audioBase64: string;
  readonly mimeType: string;
}

export interface SttTranscriptionResult {
  readonly text: string;
}

/** Erro tratado — nunca derruba o processo; quem chama decide o fallback (nunca silêncio, spec item 3). */
export class SttRequestError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = 'SttRequestError';
  }
}

export class SttTimeoutError extends SttRequestError {
  constructor(timeoutMs: number) {
    super(`chamada ao STT excedeu o timeout de ${timeoutMs}ms`);
    this.name = 'SttTimeoutError';
  }
}

export interface SttProvider {
  readonly name: string;
  transcribe: (request: SttTranscriptionRequest) => Promise<SttTranscriptionResult>;
}
