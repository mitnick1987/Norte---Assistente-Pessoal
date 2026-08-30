import type { Logger } from 'pino';
import type { LlmMessage, LlmProvider, LlmUsage, PromptFragmentSource } from '../../core/llm/index.js';
import { buildBrainSystemPrompt, formatCurrentDateTimeForPrompt, runBrainLoop, type BrainToolDefinition } from '../../core/llm/index.js';
import { toZonedParts } from '../../core/scheduler/domain/index.js';

const BRAIN_MODEL = 'claude-sonnet-5';
const BRAIN_MAX_TOKENS = 2048;

/**
 * Limite fixo de turnos da janela de conversa (spec item 4): constante de
 * código, não settings — não há necessidade de ajuste em runtime nesta
 * entrega. Cada turno consome duas linhas de `messages` (in + out), então
 * isto é "N mensagens", não "N turnos completos" — generoso o bastante para
 * cobrir uma conversa de ida e volta recente sem deixar o prompt crescer sem
 * limite (spec, item 4: sem resumo/consolidação, isso é módulo memory/M2).
 */
export const CONVERSATION_WINDOW_SIZE = 20;

export interface RecentMessage {
  readonly direction: 'in' | 'out';
  readonly body: string;
}

export interface BrainServiceDeps {
  readonly llmProvider: LlmProvider;
  /**
   * Thunks, não listas prontas: o registry de módulos/tools só fica
   * completo depois que `app.ts` termina de registrar todos os módulos
   * (inclusive `capture`, que nasce antes de terminar de montar o próprio
   * brain) — resolver em cada chamada evita depender de uma ordem de boot
   * específica ou de um objeto mutável compartilhado.
   */
  readonly getTools: () => readonly BrainToolDefinition[];
  readonly getActiveModules: () => readonly PromptFragmentSource[];
  readonly logger: Logger;
  readonly onUsage?: (usage: LlmUsage) => void;
  now?: () => Date;
}

/**
 * Brain de conversa livre (ADR-001, spec item 1): aciona o Sonnet com o
 * registry de tools quando a triagem classifica `conversa` — nenhuma escrita
 * acontece fora do que as tools validam (o loop, em `core/llm/brain-loop`,
 * garante isso). Data/hora corrente entra só na última mensagem do usuário
 * (ADR-007) — nunca no system prompt, que precisa ficar byte-estável entre
 * chamadas para o cache valer a pena.
 */
export class BrainService {
  private readonly now: () => Date;

  constructor(private readonly deps: BrainServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async reply(userText: string, history: readonly RecentMessage[], messageId: number): Promise<string> {
    const systemPrompt = buildBrainSystemPrompt(this.deps.getActiveModules());
    const currentDateTime = formatCurrentDateTimeForPrompt(toZonedParts(this.now()));

    const historyMessages: LlmMessage[] = history
      .slice(-CONVERSATION_WINDOW_SIZE)
      .map((m) => ({ role: m.direction === 'in' ? 'user' : 'assistant', content: m.body }));

    const currentMessage: LlmMessage = {
      role: 'user',
      content: `[Data e hora atuais: ${currentDateTime}]\n\n${userText}`,
    };

    const result = await runBrainLoop(
      {
        provider: this.deps.llmProvider,
        tools: this.deps.getTools(),
        logger: this.deps.logger,
        ...(this.deps.onUsage ? { onUsage: this.deps.onUsage } : {}),
      },
      {
        model: BRAIN_MODEL,
        systemPrompt,
        messages: [...historyMessages, currentMessage],
        maxTokens: BRAIN_MAX_TOKENS,
        messageId,
      },
    );

    return result.text;
  }
}
