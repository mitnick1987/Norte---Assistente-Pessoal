/**
 * Contrato de provedor de LLM plugável (ADR-017): nesta feature só
 * `anthropic-api-key` existe; `claude-account`/`openai-account` (OAuth, M3)
 * implementam a mesma interface quando chegarem — nenhum call-site de
 * `core/llm` muda quando isso acontecer.
 */

export interface LlmToolDefinition {
  readonly name: string;
  readonly description: string;
  /** JSON Schema já serializado (strict, `additionalProperties: false`) — o provedor não conhece zod. */
  readonly inputSchema: Record<string, unknown>;
}

export interface LlmMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export interface LlmCompletionRequest {
  readonly model: string;
  readonly systemPrompt: string;
  readonly messages: readonly LlmMessage[];
  readonly tools?: readonly LlmToolDefinition[];
  readonly maxTokens: number;
}

export interface LlmUsage {
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly cacheReadTokens: number;
}

export interface LlmToolCall {
  readonly toolName: string;
  readonly input: unknown;
}

export interface LlmCompletionResult {
  readonly text: string | undefined;
  readonly toolCalls: readonly LlmToolCall[];
  readonly usage: LlmUsage;
}

/** Erro tratado — nunca derruba o processo; quem chama decide o fallback (triagem cai em resposta padrão, nunca silêncio). */
export class LlmRequestError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = 'LlmRequestError';
  }
}

export class LlmTimeoutError extends LlmRequestError {
  constructor(timeoutMs: number) {
    super(`chamada ao LLM excedeu o timeout de ${timeoutMs}ms`);
    this.name = 'LlmTimeoutError';
  }
}

export interface LlmProvider {
  readonly name: string;
  complete: (request: LlmCompletionRequest) => Promise<LlmCompletionResult>;
}
