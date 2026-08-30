import type { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { Logger } from 'pino';
import type {
  LlmContentBlock,
  LlmMessage,
  LlmProvider,
  LlmToolDefinition,
  LlmUsage,
} from './provider.js';
import { LlmRequestError } from './provider.js';

/**
 * Forma mínima de `ToolDefinition` que o loop precisa conhecer — evita
 * `core/llm` importar `core/kernel` só por causa do tipo (o kernel já
 * importa `core/llm` transitivamente via módulos; um ciclo de import não
 * vale a pena por uma interface estrutural).
 */
export interface BrainToolDefinition<TInput = unknown> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodType<TInput>;
  handler: (input: TInput, ctx: BrainToolCallContext) => Promise<unknown>;
}

/** Espelha `ToolCallContext` do kernel (mesmo motivo de não importar o tipo: evitar ciclo). */
export interface BrainToolCallContext {
  readonly messageId: number;
}

export interface BrainLoopDeps {
  readonly provider: LlmProvider;
  readonly tools: readonly BrainToolDefinition[];
  readonly logger: Logger;
  readonly onUsage?: (usage: LlmUsage) => void;
}

export interface BrainLoopRequest {
  readonly model: string;
  readonly systemPrompt: string;
  readonly messages: readonly LlmMessage[];
  readonly maxTokens: number;
  /** Mensagem de entrada que originou este turno (FEAT-006 item 2) — repassada às tools via `ToolCallContext`. */
  readonly messageId: number;
}

export interface BrainLoopResult {
  readonly text: string;
}

/**
 * Teto de iterações do loop (spec, Decisões tomadas): proteção de
 * engenharia contra o modelo entrar em ciclo de tool calls, não parâmetro de
 * produto — por isso é constante de código, não settings.
 */
const MAX_TOOL_ITERATIONS = 6;

const FALLBACK_MESSAGE = 'não consegui terminar de processar isso agora — tenta de novo em instantes?';

/** Nunca vaza detalhe interno (nome de tool, stack trace) para o próprio modelo — mensagem curta e genérica, o bastante para ele tentar de novo ou desistir (spec item 1). */
function toToolResultError(reason: 'unknown_tool' | 'invalid_input' | 'handler_failed'): string {
  if (reason === 'unknown_tool') return 'essa ferramenta não existe.';
  if (reason === 'invalid_input') return 'entrada inválida para essa ferramenta.';
  return 'falha ao executar essa ferramenta agora.';
}

/**
 * O provedor Anthropic não conhece zod — schema strict serializado a partir
 * do próprio schema zod da tool (`zod-to-json-schema`, mesma origem de
 * verdade que valida o input no `resolveToolCall`, nunca duas declarações
 * divergentes). `$refStrategy: 'none'` porque a Messages API não segue
 * `$ref`/`definitions` no `input_schema` — schemas desta escala (objetos
 * achatados) não precisam de referência mesmo.
 */
function toJsonSchemaTools(tools: readonly BrainToolDefinition[]): LlmToolDefinition[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: zodToJsonSchema(tool.inputSchema, { target: 'openApi3', $refStrategy: 'none' }) as Record<
      string,
      unknown
    >,
  }));
}

/**
 * Loop de tool-use manual do brain (ADR-001, spec item 1): chama o Sonnet,
 * resolve cada `tool_use` contra o registry validando com o `inputSchema`
 * zod antes de qualquer `handler`, devolve o resultado como `tool_result` e
 * repete até a resposta ser só texto. Tool fora do registry ou input que
 * falha a validação nunca chega a um handler — vira erro estruturado
 * devolvido ao próprio modelo, nunca uma exceção crua para quem chamou o
 * loop (spec item 1, SECURITY.md: erro de validação não vaza detalhe
 * interno).
 */
export async function runBrainLoop(deps: BrainLoopDeps, request: BrainLoopRequest): Promise<BrainLoopResult> {
  const toolsByName = new Map(deps.tools.map((t) => [t.name, t]));
  const jsonSchemaTools = toJsonSchemaTools(deps.tools);

  let messages: LlmMessage[] = [...request.messages];

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    const result = await deps.provider.complete({
      model: request.model,
      systemPrompt: request.systemPrompt,
      messages,
      tools: jsonSchemaTools,
      maxTokens: request.maxTokens,
      cacheSystemPrompt: true,
    });

    deps.onUsage?.(result.usage);

    if (result.toolCalls.length === 0) {
      return { text: result.text ?? FALLBACK_MESSAGE };
    }

    const assistantBlocks: LlmContentBlock[] = [
      ...(result.text ? [{ type: 'text' as const, text: result.text }] : []),
      ...result.toolCalls.map((call) => ({ type: 'tool_use' as const, id: call.id, name: call.toolName, input: call.input })),
    ];

    const toolResultBlocks: LlmContentBlock[] = [];
    for (const call of result.toolCalls) {
      toolResultBlocks.push(await resolveToolCall(toolsByName, call, deps.logger, { messageId: request.messageId }));
    }

    messages = [
      ...messages,
      { role: 'assistant', content: assistantBlocks },
      { role: 'user', content: toolResultBlocks },
    ];
  }

  deps.logger.warn({ iterations: MAX_TOOL_ITERATIONS }, 'loop de tool-use do brain atingiu o teto de iterações');
  return { text: FALLBACK_MESSAGE };
}

async function resolveToolCall(
  toolsByName: ReadonlyMap<string, BrainToolDefinition>,
  call: { readonly id: string; readonly toolName: string; readonly input: unknown },
  logger: Logger,
  ctx: BrainToolCallContext,
): Promise<LlmContentBlock> {
  const tool = toolsByName.get(call.toolName);
  if (!tool) {
    logger.warn({ toolName: call.toolName }, 'brain pediu tool fora do registry');
    return { type: 'tool_result', toolUseId: call.id, content: toToolResultError('unknown_tool'), isError: true };
  }

  const parsed = tool.inputSchema.safeParse(call.input);
  if (!parsed.success) {
    logger.warn({ toolName: call.toolName, issues: parsed.error.issues }, 'input de tool do brain falhou a validação zod');
    return { type: 'tool_result', toolUseId: call.id, content: toToolResultError('invalid_input'), isError: true };
  }

  try {
    const output = await tool.handler(parsed.data, ctx);
    return { type: 'tool_result', toolUseId: call.id, content: JSON.stringify(output ?? null) };
  } catch (err) {
    if (err instanceof LlmRequestError) throw err;
    // Nunca `err` bruto no log (mesmo cuidado de google-calendar-service.ts):
    // um handler de tool pode envolver uma lib de terceiro (ex.: googleapis)
    // cujo erro carrega o corpo/headers da requisição em `config` — só a
    // mensagem já basta para investigar.
    const message = err instanceof Error ? err.message : 'erro desconhecido';
    logger.error({ toolName: call.toolName, message }, 'handler de tool do brain falhou');
    return { type: 'tool_result', toolUseId: call.id, content: toToolResultError('handler_failed'), isError: true };
  }
}
