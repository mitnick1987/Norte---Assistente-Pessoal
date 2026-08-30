import {
  LlmRequestError,
  LlmTimeoutError,
  type LlmCompletionRequest,
  type LlmCompletionResult,
  type LlmProvider,
  type LlmToolCall,
} from './provider.js';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

export interface AnthropicApiKeyProviderConfig {
  readonly apiKey: string;
  readonly timeoutMs?: number;
  /** Injetável para teste — nunca fetch global real no caminho testado (TESTING.md §7). */
  readonly fetchFn?: typeof fetch;
}

interface AnthropicContentBlock {
  readonly type: string;
  readonly text?: string;
  readonly name?: string;
  readonly input?: unknown;
}

interface AnthropicResponseBody {
  readonly content?: readonly AnthropicContentBlock[];
  readonly usage?: {
    readonly input_tokens?: number;
    readonly output_tokens?: number;
    readonly cache_read_input_tokens?: number;
  };
  readonly error?: { readonly message?: string };
}

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Único provedor implementado nesta feature (ADR-017). API key é o caminho
 * padrão e o único suportado no caminho crítico — nunca aparece em log
 * (SECURITY.md §4, redigido pelo logger antes mesmo de chegar aqui, mas o
 * client também nunca inclui a key em nenhum objeto que não seja o header).
 */
export class AnthropicApiKeyProvider implements LlmProvider {
  readonly name = 'anthropic-api-key';

  constructor(private readonly config: AnthropicApiKeyProviderConfig) {}

  async complete(request: LlmCompletionRequest): Promise<LlmCompletionResult> {
    const doFetch = this.config.fetchFn ?? fetch;
    const timeoutMs = this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await doFetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify(this.buildRequestBody(request)),
        signal: controller.signal,
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new LlmTimeoutError(timeoutMs);
      }
      throw new LlmRequestError('falha de rede ao chamar a API da Anthropic', err);
    } finally {
      clearTimeout(timer);
    }

    // Gateway/proxy intermediário (Caddy, CDN, load balancer) pode responder
    // 502/503/504 com corpo HTML/texto em vez de JSON — response.json() lança
    // SyntaxError nesse caso, que não é LlmRequestError e escaparia do
    // tratamento de erro da triagem (silêncio proibido, ver spec item 2).
    let body: AnthropicResponseBody;
    try {
      body = (await response.json()) as AnthropicResponseBody;
    } catch (err) {
      throw new LlmRequestError(
        `API da Anthropic respondeu ${response.status} com corpo não-JSON`,
        err,
      );
    }

    if (!response.ok) {
      throw new LlmRequestError(
        `API da Anthropic respondeu ${response.status}: ${body.error?.message ?? 'erro desconhecido'}`,
      );
    }

    return this.parseResponse(body);
  }

  private buildRequestBody(request: LlmCompletionRequest): Record<string, unknown> {
    return {
      model: request.model,
      max_tokens: request.maxTokens,
      system: request.systemPrompt,
      messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
      ...(request.tools && request.tools.length > 0
        ? {
            tools: request.tools.map((t) => ({
              name: t.name,
              description: t.description,
              input_schema: t.inputSchema,
            })),
          }
        : {}),
    };
  }

  private parseResponse(body: AnthropicResponseBody): LlmCompletionResult {
    const blocks = body.content ?? [];

    const textBlock = blocks.find((b) => b.type === 'text');
    const toolCalls: LlmToolCall[] = blocks
      .filter((b) => b.type === 'tool_use' && b.name)
      .map((b) => ({ toolName: b.name!, input: b.input }));

    return {
      text: textBlock?.text,
      toolCalls,
      usage: {
        tokensIn: body.usage?.input_tokens ?? 0,
        tokensOut: body.usage?.output_tokens ?? 0,
        cacheReadTokens: body.usage?.cache_read_input_tokens ?? 0,
      },
    };
  }
}
