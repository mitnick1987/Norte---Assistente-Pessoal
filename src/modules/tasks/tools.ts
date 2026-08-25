import { z } from 'zod';
import type { ToolDefinition } from '../../core/kernel/types.js';
import type { ItemRecord } from './domain/index.js';
import type { ItemService } from './item-service.js';
import { ItemNotFoundError } from './item-service.js';
import { InvalidStatusTransitionError } from './domain/index.js';

/**
 * Payload de saída das tools, exposto ao LLM e a qualquer transporte futuro
 * (MCP, ADR-014). `snoozeCount` do domínio nunca chega aqui — a omissão é
 * estrutural (o tipo não tem o campo), não uma questão de lembrar de
 * filtrar na hora de montar a resposta (RF-11, SECURITY.md).
 */
export interface ItemToolOutput {
  readonly id: number;
  readonly type: ItemRecord['type'];
  readonly title: string;
  readonly status: ItemRecord['status'];
  readonly priority: ItemRecord['priority'];
  readonly dueAt: string | null;
}

function toToolOutput(item: ItemRecord): ItemToolOutput {
  return {
    id: item.id,
    type: item.type,
    title: item.title,
    status: item.status,
    priority: item.priority,
    dueAt: item.dueAt,
  };
}

const createItemInputSchema = z
  .object({
    type: z.enum(['tarefa', 'ideia', 'compromisso', 'lembrete', 'nota']),
    title: z.string().min(1).max(500),
    origin: z.enum(['texto', 'audio', 'foto', 'encaminhada', 'email', 'trabalho']),
    priority: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
    dueAt: z.string().datetime().optional(),
    /** Classificação ambígua da triagem cai em inbox (RF-01) — omitido, o serviço assume 'ativa'. */
    ambiguous: z.boolean().optional(),
  })
  .strict();

type CreateItemInput = z.infer<typeof createItemInputSchema>;

const itemIdInputSchema = z.object({ id: z.number().int().positive() }).strict();
type ItemIdInput = z.infer<typeof itemIdInputSchema>;

const snoozeItemInputSchema = z
  .object({ id: z.number().int().positive(), relativeDateText: z.string().min(1).max(200) })
  .strict();
type SnoozeItemInput = z.infer<typeof snoozeItemInputSchema>;

const listItemsInputSchema = z.object({ includeInbox: z.boolean().optional() }).strict();
type ListItemsInput = z.infer<typeof listItemsInputSchema>;

/**
 * Tools declaradas uma vez, servidas em dois transportes (ADR-014): tool use
 * do brain hoje, servidor MCP no M2, sem mudar de forma. JSON Schema strict
 * (`additionalProperties: false` via `.strict()`) e validação zod aqui são a
 * única porta de escrita do task-store — o modelo nunca grava por SQL.
 */
/**
 * Cada `ToolDefinition<TInput>` concreto tem um `handler` cujo parâmetro é
 * contravariante em TInput — um array com elementos de TInput diferentes
 * não unifica em `ToolDefinition<unknown>[]` sem essa normalização
 * explícita. O cast é seguro porque o registry (kernel) nunca chama
 * `handler` com um input que não tenha passado pelo `inputSchema.parse`
 * desse mesmo objeto antes — a validação e a execução são sempre a mesma
 * tool, nunca cruzadas.
 */
function toUntyped<TInput>(tool: ToolDefinition<TInput>): ToolDefinition {
  return tool as unknown as ToolDefinition;
}

export function buildTasksTools(service: ItemService): ToolDefinition[] {
  const createItem: ToolDefinition<CreateItemInput> = {
    name: 'create_item',
    description: 'Cria um item (tarefa, ideia, compromisso, lembrete ou nota) no task-store.',
    inputSchema: createItemInputSchema,
    async handler(input) {
      const item = service.create({
        type: input.type,
        title: input.title,
        origin: input.origin,
        status: input.ambiguous ? 'inbox' : 'ativa',
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.dueAt !== undefined ? { dueAt: new Date(input.dueAt) } : {}),
      });
      return toToolOutput(item);
    },
  };

  const completeItem: ToolDefinition<ItemIdInput> = {
    name: 'complete_item',
    description: 'Marca um item como feito.',
    inputSchema: itemIdInputSchema,
    async handler(input) {
      return toToolOutput(service.complete(input.id));
    },
  };

  const snoozeItem: ToolDefinition<SnoozeItemInput> = {
    name: 'snooze_item',
    description: 'Adia um item para uma data relativa em português (ex.: "sexta", "amanhã 14h").',
    inputSchema: snoozeItemInputSchema,
    async handler(input) {
      const result = service.snoozeByText(input.id, input.relativeDateText);
      if (!result) {
        throw new UnrecognizedDateError(input.relativeDateText);
      }
      return toToolOutput(result);
    },
  };

  const dropItem: ToolDefinition<ItemIdInput> = {
    name: 'drop_item',
    description: 'Dropa um item (deleção lógica, reversível — nunca remove a linha).',
    inputSchema: itemIdInputSchema,
    async handler(input) {
      return toToolOutput(service.drop(input.id));
    },
  };

  const listItems: ToolDefinition<ListItemsInput> = {
    name: 'list_items',
    description: 'Lista os itens ativos (nunca inclui campos internos de domínio).',
    inputSchema: listItemsInputSchema,
    async handler(input) {
      return service.list({ includeInbox: input.includeInbox ?? false }).map(toToolOutput);
    },
  };

  return [
    toUntyped(createItem),
    toUntyped(completeItem),
    toUntyped(snoozeItem),
    toUntyped(dropItem),
    toUntyped(listItems),
  ];
}

export class UnrecognizedDateError extends Error {
  constructor(text: string) {
    super(`data não reconhecida: "${text}"`);
    this.name = 'UnrecognizedDateError';
  }
}

export { ItemNotFoundError, InvalidStatusTransitionError };
