import type { Logger } from 'pino';
import type { LlmProvider, LlmToolDefinition } from '../../core/llm/index.js';
import { LlmRequestError } from '../../core/llm/index.js';
import { TRIAGE_SYSTEM_PROMPT, triageOutputSchema, type TriageOutput } from './domain/index.js';

const TRIAGE_MODEL = 'claude-haiku-4-5-20251001';
const TRIAGE_MAX_TOKENS = 1024;

const SUBMIT_TRIAGE_TOOL: LlmToolDefinition = {
  name: 'submit_triage',
  description: 'Envia o resultado da classificação da mensagem recebida.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['classification', 'items'],
    properties: {
      classification: { type: 'string', enum: ['captura', 'comando', 'conversa'] },
      items: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['type', 'title'],
          properties: {
            type: { type: 'string', enum: ['tarefa', 'ideia', 'compromisso', 'lembrete', 'nota'] },
            title: { type: 'string' },
            dueAt: { type: 'string' },
            ambiguous: { type: 'boolean' },
          },
        },
      },
    },
  },
};

export interface TriageServiceDeps {
  readonly provider: LlmProvider;
  readonly logger: Logger;
  readonly onUsage: (usage: { tokensIn: number; tokensOut: number; cacheReadTokens: number }) => void;
}

export type TriageResult = { readonly kind: 'ok'; readonly output: TriageOutput } | { readonly kind: 'error' };

/**
 * Chamada real ao Haiku (ADR-007) para classificar a mensagem recebida.
 * Erro ou timeout do provedor nunca propaga como exceção não tratada — vira
 * `{ kind: 'error' }`, e quem chama decide o fallback (RF-01: cai em
 * resposta padrão, nunca em silêncio).
 */
export class TriageService {
  constructor(private readonly deps: TriageServiceDeps) {}

  async classify(text: string): Promise<TriageResult> {
    try {
      const result = await this.deps.provider.complete({
        model: TRIAGE_MODEL,
        systemPrompt: TRIAGE_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: text }],
        tools: [SUBMIT_TRIAGE_TOOL],
        maxTokens: TRIAGE_MAX_TOKENS,
      });

      this.deps.onUsage(result.usage);

      const call = result.toolCalls.find((c) => c.toolName === 'submit_triage');
      if (!call) {
        this.deps.logger.warn('triagem não retornou tool call submit_triage');
        return { kind: 'error' };
      }

      const parsed = triageOutputSchema.safeParse(call.input);
      if (!parsed.success) {
        this.deps.logger.warn({ issues: parsed.error.issues }, 'saída da triagem fora do schema esperado');
        return { kind: 'error' };
      }

      return { kind: 'ok', output: parsed.data };
    } catch (err) {
      if (err instanceof LlmRequestError) {
        this.deps.logger.error({ err }, 'falha ao chamar a triagem, caindo em fallback');
        return { kind: 'error' };
      }
      throw err;
    }
  }
}
