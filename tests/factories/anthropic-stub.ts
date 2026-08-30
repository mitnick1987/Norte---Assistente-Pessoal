import { jsonResponse } from './fetch-stub.js';

export interface StubTriageResult {
  readonly classification: 'captura' | 'comando' | 'conversa';
  readonly items?: readonly {
    readonly type: 'tarefa' | 'ideia' | 'compromisso' | 'lembrete' | 'nota';
    readonly title: string;
    /** Expressão relativa em PT-BR (ADR-006) — o backend resolve, nunca o modelo. */
    readonly dueExpression?: string;
    readonly ambiguous?: boolean;
  }[];
  readonly usage?: { readonly input_tokens?: number; readonly output_tokens?: number; readonly cache_read_input_tokens?: number };
}

/**
 * Resposta da Anthropic Messages API contendo só uma tool call
 * `submit_triage` — formato mínimo que `AnthropicApiKeyProvider` sabe
 * parsear. Usado para stubar a triagem sem bater na API real (TESTING.md §2).
 */
export function anthropicToolUseResponse(result: StubTriageResult): Response {
  return jsonResponse(200, {
    content: [
      {
        type: 'tool_use',
        name: 'submit_triage',
        input: { classification: result.classification, items: result.items ?? [] },
      },
    ],
    usage: {
      input_tokens: result.usage?.input_tokens ?? 100,
      output_tokens: result.usage?.output_tokens ?? 50,
      cache_read_input_tokens: result.usage?.cache_read_input_tokens ?? 0,
    },
  });
}

export function anthropicErrorResponse(status: number, message = 'erro simulado'): Response {
  return jsonResponse(status, { error: { message } });
}
