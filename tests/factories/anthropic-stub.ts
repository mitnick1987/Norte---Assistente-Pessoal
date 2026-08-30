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
        id: 'tc_1',
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

export interface StubUsage {
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly cache_read_input_tokens?: number;
}

/** Resposta só de texto (sem tool_use) — usada pelo brain quando o modelo termina o turno ou pelos rituais (redação sem tool use). */
export function anthropicTextResponse(text: string, usage: StubUsage = {}): Response {
  return jsonResponse(200, {
    content: [{ type: 'text', text }],
    usage: {
      input_tokens: usage.input_tokens ?? 100,
      output_tokens: usage.output_tokens ?? 50,
      cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
    },
  });
}

export interface StubToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
}

/** Resposta com uma ou mais tool calls arbitrárias (brain-loop, FEAT-006) — diferente de `anthropicToolUseResponse`, que é específico do formato `submit_triage` da triagem. */
export function anthropicBrainToolUseResponse(
  toolCalls: readonly StubToolCall[],
  usage: StubUsage = {},
  text?: string,
): Response {
  return jsonResponse(200, {
    content: [
      ...(text ? [{ type: 'text', text }] : []),
      ...toolCalls.map((call) => ({ type: 'tool_use', id: call.id, name: call.name, input: call.input })),
    ],
    usage: {
      input_tokens: usage.input_tokens ?? 100,
      output_tokens: usage.output_tokens ?? 50,
      cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
    },
  });
}
