import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/core/db/migrator.js';
import { tasksMigrations } from '../../src/modules/tasks/migrations/index.js';
import { ItemsRepository } from '../../src/modules/tasks/items-repository.js';
import { ItemService } from '../../src/modules/tasks/item-service.js';
import { buildTasksTools, UnrecognizedDateError } from '../../src/modules/tasks/tools.js';

const FIXED_NOW = new Date('2026-08-25T13:00:00.000Z');
const TEST_CTX = { messageId: 1 };

function buildTools() {
  const db = new Database(':memory:');
  runMigrations(db, tasksMigrations);
  const service = new ItemService(new ItemsRepository(db), () => FIXED_NOW);
  const tools = buildTasksTools(service);
  return { service, tools };
}

function findTool(tools: ReturnType<typeof buildTasksTools>, name: string) {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} não encontrada`);
  return tool;
}

describe('tools do task-store (strict, ADR-014)', () => {
  it('create_item rejeita campo desconhecido (additionalProperties: false)', () => {
    const { tools } = buildTools();
    const createItem = findTool(tools, 'create_item');

    const result = createItem.inputSchema.safeParse({
      type: 'tarefa',
      title: 'x',
      origin: 'texto',
      campoInvasor: 'valor',
    });

    expect(result.success).toBe(false);
  });

  it('create_item aceita payload válido e grava no task-store', async () => {
    const { tools } = buildTools();
    const createItem = findTool(tools, 'create_item');

    const output = (await createItem.handler(
      createItem.inputSchema.parse({ type: 'tarefa', title: 'pagar boleto', origin: 'texto' }),
      TEST_CTX,
    )) as { id: number; status: string };

    expect(output.status).toBe('ativa');
  });

  it('create_item com ambiguous=true grava em inbox', async () => {
    const { tools } = buildTools();
    const createItem = findTool(tools, 'create_item');

    const output = (await createItem.handler(
      createItem.inputSchema.parse({ type: 'tarefa', title: 'algo incerto', origin: 'texto', ambiguous: true }),
      TEST_CTX,
    )) as { status: string };

    expect(output.status).toBe('inbox');
  });

  it('list_items nunca inclui snoozeCount (nem sua chave) no payload de saída — RF-11', async () => {
    const { service, tools } = buildTools();
    const item = service.create({ type: 'tarefa', title: 'x', origin: 'texto' });
    service.snoozeByText(item.id, 'sexta');

    const listItems = findTool(tools, 'list_items');
    const output = (await listItems.handler(
      listItems.inputSchema.parse({ includeInbox: true }),
      TEST_CTX,
    )) as Record<string, unknown>[];

    expect(output).toHaveLength(1);
    expect(Object.keys(output[0]!)).not.toContain('snoozeCount');
    expect(JSON.stringify(output)).not.toMatch(/snooze/i);
  });

  it('complete_item marca como feita e retorna o item atualizado', async () => {
    const { service, tools } = buildTools();
    const item = service.create({ type: 'tarefa', title: 'x', origin: 'texto' });

    const completeItem = findTool(tools, 'complete_item');
    const output = (await completeItem.handler(completeItem.inputSchema.parse({ id: item.id }), TEST_CTX)) as {
      status: string;
    };

    expect(output.status).toBe('feita');
  });

  it('drop_item nunca deleta a linha, só muda status (ADR-009)', async () => {
    const { service, tools } = buildTools();
    const item = service.create({ type: 'tarefa', title: 'x', origin: 'texto' });

    const dropItem = findTool(tools, 'drop_item');
    const output = (await dropItem.handler(dropItem.inputSchema.parse({ id: item.id }), TEST_CTX)) as {
      status: string;
    };

    expect(output.status).toBe('dropada');
  });

  it('snooze_item lança UnrecognizedDateError para texto sem data reconhecível', async () => {
    const { service, tools } = buildTools();
    const item = service.create({ type: 'tarefa', title: 'x', origin: 'texto' });

    const snoozeItem = findTool(tools, 'snooze_item');

    await expect(
      snoozeItem.handler(
        snoozeItem.inputSchema.parse({ id: item.id, relativeDateText: 'não sei quando' }),
        TEST_CTX,
      ),
    ).rejects.toThrow(UnrecognizedDateError);
  });
});
