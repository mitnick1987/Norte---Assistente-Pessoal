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

/**
 * Blocos estruturados de conteúdo (necessários para reconstruir uma rodada
 * de tool use dentro do loop, ADR-001): um turno `assistant` que pediu tools
 * carrega os blocos `tool_use` originais (com `id`) de volta na próxima
 * chamada, e o turno `user` seguinte carrega os `tool_result` casados por
 * `toolUseId` — é o formato que a Messages API exige para a conversa ficar
 * coerente. Texto simples (`string`) continua válido para o caso comum
 * (mensagem de usuário, resposta final em texto) sem forçar todo call-site
 * a montar blocks à toa.
 */
export type LlmContentBlock =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'tool_use'; readonly id: string; readonly name: string; readonly input: unknown }
  | { readonly type: 'tool_result'; readonly toolUseId: string; readonly content: string; readonly isError?: boolean };

export interface LlmMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string | readonly LlmContentBlock[];
}

export interface LlmCompletionRequest {
  readonly model: string;
  readonly systemPrompt: string;
  readonly messages: readonly LlmMessage[];
  readonly tools?: readonly LlmToolDefinition[];
  readonly maxTokens: number;
  /**
   * Marca o `systemPrompt` inteiro como prefixo cacheável (`cache_control:
   * ephemeral`, ADR-007) — só o brain usa isso: o system prompt precisa ser
   * grande e byte-estável o bastante para o cache valer a pena (múltiplos
   * fragmentos de módulo + regras de tom); a triagem (Haiku) não liga.
   */
  readonly cacheSystemPrompt?: boolean;
}

export interface LlmUsage {
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly cacheReadTokens: number;
}

export interface LlmToolCall {
  /** Casa a resposta (`tool_result`) ao `tool_use` correspondente na próxima chamada — obrigatório na Messages API real. */
  readonly id: string;
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
