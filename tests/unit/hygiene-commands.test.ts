import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/core/db/migrator.js';
import { coreMigrations } from '../../src/core/db/migrations/index.js';
import { tasksMigrations } from '../../src/modules/tasks/migrations/index.js';
import { ItemsRepository } from '../../src/modules/tasks/items-repository.js';
import { ItemService } from '../../src/modules/tasks/item-service.js';
import { PendingMenuRepository } from '../../src/core/menu/index.js';
import { HygieneService } from '../../src/modules/hygiene/hygiene-service.js';
import { buildHygieneCommands } from '../../src/modules/hygiene/commands.js';

const NOW = new Date('2026-08-30T23:00:00.000Z');

function buildContext() {
  const db = new Database(':memory:');
  runMigrations(db, [...coreMigrations, ...tasksMigrations]);

  const itemService = new ItemService(new ItemsRepository(db), () => NOW);
  const hygieneService = new HygieneService({ itemService, now: () => NOW });
  const pendingMenuRepository = new PendingMenuRepository(db);
  const commands = buildHygieneCommands(itemService, hygieneService, pendingMenuRepository, () => NOW);

  return { db, itemService, pendingMenuRepository, commands };
}

function findCommand(commands: ReturnType<typeof buildHygieneCommands>, name: string) {
  const command = commands.find((c) => c.name === name);
  if (!command) throw new Error(`command ${name} não encontrado`);
  return command;
}

describe('comandos de resposta à proposta de higiene (RF-11, menu 1/2/3)', () => {
  it('"1"/"2"/"3" não casam sem proposta de higiene pendente', () => {
    const { commands } = buildContext();

    expect(findCommand(commands, 'hygiene.proposal.archive').match({ text: '1', ownerJid: 'x' })).toBe(false);
    expect(findCommand(commands, 'hygiene.proposal.drop').match({ text: '2', ownerJid: 'x' })).toBe(false);
    expect(findCommand(commands, 'hygiene.proposal.snooze').match({ text: '3', ownerJid: 'x' })).toBe(false);
  });

  it('"1" arquiva o item (deleção lógica)', async () => {
    const { itemService, pendingMenuRepository, commands } = buildContext();
    const item = itemService.create({ type: 'tarefa', title: 'projeto parado', origin: 'texto' });
    pendingMenuRepository.record('higiene', item.id);

    const command = findCommand(commands, 'hygiene.proposal.archive');
    expect(command.match({ text: '1', ownerJid: 'x' })).toBe(true);
    await command.handle({ text: '1', ownerJid: 'x' });

    const row = itemService.findById(item.id);
    expect(row?.status).toBe('arquivada');
  });

  it('"2" dropa o item (deleção lógica)', async () => {
    const { itemService, pendingMenuRepository, commands } = buildContext();
    const item = itemService.create({ type: 'tarefa', title: 'projeto parado', origin: 'texto' });
    pendingMenuRepository.record('higiene', item.id);

    const command = findCommand(commands, 'hygiene.proposal.drop');
    await command.handle({ text: '2', ownerJid: 'x' });

    const row = itemService.findById(item.id);
    expect(row?.status).toBe('dropada');
  });

  it('"3" adia pro mês que vem, sem perguntar "para quando?"', async () => {
    const { itemService, pendingMenuRepository, commands } = buildContext();
    const item = itemService.create({ type: 'tarefa', title: 'projeto parado', origin: 'texto' });
    pendingMenuRepository.record('higiene', item.id);

    const command = findCommand(commands, 'hygiene.proposal.snooze');
    const result = await command.handle({ text: '3', ownerJid: 'x' });

    expect(result.replyText.toLowerCase()).not.toContain('para quando');
    const row = itemService.findById(item.id);
    expect(row?.status).toBe('adiada');
    expect(new Date(row!.dueAt!).getTime()).toBeGreaterThan(NOW.getTime());
  });

  it('menu pendente de outra origem (cobrança) não é resolvido aqui', () => {
    const { itemService, pendingMenuRepository, commands } = buildContext();
    const item = itemService.create({ type: 'tarefa', title: 'pagar boleto', origin: 'texto' });
    pendingMenuRepository.record('cobranca', item.id);

    expect(findCommand(commands, 'hygiene.proposal.archive').match({ text: '1', ownerJid: 'x' })).toBe(false);
  });

  it('item já em estado terminal antes da resposta chegar: resolve graciosamente, sem lançar', async () => {
    const { itemService, pendingMenuRepository, commands } = buildContext();
    const item = itemService.create({ type: 'tarefa', title: 'projeto parado', origin: 'texto' });
    pendingMenuRepository.record('higiene', item.id);
    await itemService.drop(item.id);

    const command = findCommand(commands, 'hygiene.proposal.archive');
    const result = await command.handle({ text: '1', ownerJid: 'x' });

    expect(result.replyText).toBeTruthy();
    const row = itemService.findById(item.id);
    expect(row?.status).toBe('dropada');
  });
});
