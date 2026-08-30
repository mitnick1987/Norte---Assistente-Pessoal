import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/core/db/migrator.js';
import { coreMigrations } from '../../src/core/db/migrations/index.js';
import { tasksMigrations } from '../../src/modules/tasks/migrations/index.js';
import { ItemsRepository } from '../../src/modules/tasks/items-repository.js';
import { ItemService } from '../../src/modules/tasks/item-service.js';
import { PendingMenuRepository } from '../../src/core/menu/index.js';
import { buildRitualsCommands } from '../../src/modules/rituals/commands.js';

const NOW = new Date('2026-08-30T23:00:00.000Z');

function buildContext() {
  const db = new Database(':memory:');
  runMigrations(db, [...coreMigrations, ...tasksMigrations]);

  const itemService = new ItemService(new ItemsRepository(db), () => NOW);
  const pendingMenuRepository = new PendingMenuRepository(db);
  const commands = buildRitualsCommands(itemService, pendingMenuRepository, () => NOW);

  return { db, itemService, pendingMenuRepository, commands };
}

function findCommand(commands: ReturnType<typeof buildRitualsCommands>, name: string) {
  const command = commands.find((c) => c.name === name);
  if (!command) throw new Error(`command ${name} não encontrado`);
  return command;
}

describe('comandos de resposta à decisão genérica da revisão noturna (RF-06, menu 1/2/3)', () => {
  it('"1"/"2"/"3" não casam sem decisão de revisão pendente', () => {
    const { commands } = buildContext();

    for (const digit of ['1', '2', '3']) {
      expect(findCommand(commands, `rituals.review.${digit === '1' ? 'keep' : digit === '2' ? 'snooze' : 'drop'}`).match({ text: digit, ownerJid: 'x' })).toBe(false);
    }
  });

  it('"1" mantém o item como está (nenhuma transição de status)', async () => {
    const { itemService, pendingMenuRepository, commands } = buildContext();
    const item = itemService.create({ type: 'tarefa', title: 'projeto parado', origin: 'texto' });
    pendingMenuRepository.record('revisao', item.id);

    const command = findCommand(commands, 'rituals.review.keep');
    expect(command.match({ text: '1', ownerJid: 'x' })).toBe(true);
    await command.handle({ text: '1', ownerJid: 'x' });

    const row = itemService.findById(item.id);
    expect(row?.status).toBe('ativa');
  });

  it('"3" dropa o item (deleção lógica)', async () => {
    const { itemService, pendingMenuRepository, commands } = buildContext();
    const item = itemService.create({ type: 'tarefa', title: 'projeto parado', origin: 'texto' });
    pendingMenuRepository.record('revisao', item.id);

    const command = findCommand(commands, 'rituals.review.drop');
    await command.handle({ text: '3', ownerJid: 'x' });

    const row = itemService.findById(item.id);
    expect(row?.status).toBe('dropada');
  });

  it('"2" adia o item, nunca pergunta "para quando?"', async () => {
    const { itemService, pendingMenuRepository, commands } = buildContext();
    const item = itemService.create({ type: 'tarefa', title: 'projeto parado', origin: 'texto' });
    pendingMenuRepository.record('revisao', item.id);

    const command = findCommand(commands, 'rituals.review.snooze');
    const result = await command.handle({ text: '2', ownerJid: 'x' });

    expect(result.replyText.toLowerCase()).not.toContain('para quando');
    const row = itemService.findById(item.id);
    expect(row?.status).toBe('adiada');
  });

  it('depois de resolvido, o mesmo menu não pode ser respondido de novo', async () => {
    const { itemService, pendingMenuRepository, commands } = buildContext();
    const item = itemService.create({ type: 'tarefa', title: 'projeto parado', origin: 'texto' });
    pendingMenuRepository.record('revisao', item.id);

    const command = findCommand(commands, 'rituals.review.keep');
    await command.handle({ text: '1', ownerJid: 'x' });

    expect(command.match({ text: '1', ownerJid: 'x' })).toBe(false);
  });

  it('menu pendente de outra origem (cobrança) não é resolvido aqui', () => {
    const { itemService, pendingMenuRepository, commands } = buildContext();
    const item = itemService.create({ type: 'tarefa', title: 'pagar boleto', origin: 'texto' });
    pendingMenuRepository.record('cobranca', item.id);

    const command = findCommand(commands, 'rituals.review.keep');
    expect(command.match({ text: '1', ownerJid: 'x' })).toBe(false);
  });

  it('item já em estado terminal antes da resposta chegar: resolve graciosamente, sem lançar', async () => {
    const { itemService, pendingMenuRepository, commands } = buildContext();
    const item = itemService.create({ type: 'tarefa', title: 'projeto parado', origin: 'texto' });
    pendingMenuRepository.record('revisao', item.id);
    itemService.complete(item.id);

    const command = findCommand(commands, 'rituals.review.drop');
    const result = await command.handle({ text: '3', ownerJid: 'x' });

    expect(result.replyText).toBeTruthy();
    const row = itemService.findById(item.id);
    expect(row?.status).toBe('feita');
  });
});
