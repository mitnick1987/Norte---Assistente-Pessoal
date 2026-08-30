import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/core/db/migrator.js';
import { tasksMigrations } from '../../src/modules/tasks/migrations/index.js';
import { ItemsRepository } from '../../src/modules/tasks/items-repository.js';
import { ItemService } from '../../src/modules/tasks/item-service.js';
import { buildNextActionCommands } from '../../src/modules/next-action/commands.js';

const FIXED_NOW = new Date('2026-08-25T13:00:00.000Z');
const OWNER_JID = '5511999999999@s.whatsapp.net';

function buildCommands() {
  const db = new Database(':memory:');
  runMigrations(db, tasksMigrations);
  const service = new ItemService(new ItemsRepository(db), () => FIXED_NOW);
  return { service, commands: buildNextActionCommands(service) };
}

function findCommand(commands: ReturnType<typeof buildNextActionCommands>, name: string) {
  const command = commands.find((c) => c.name === name);
  if (!command) throw new Error(`command ${name} não encontrado`);
  return command;
}

describe('comando "qual a próxima?" (RF-09)', () => {
  it('reconhece as variações do vocabulário fixo da spec', () => {
    const { commands } = buildCommands();
    const command = findCommand(commands, 'next-action.query');

    expect(command.match({ text: 'qual a proxima', ownerJid: OWNER_JID })).toBe(true);
    expect(command.match({ text: 'qual a próxima?', ownerJid: OWNER_JID })).toBe(true);
    expect(command.match({ text: 'o que eu faço agora', ownerJid: OWNER_JID })).toBe(true);
    expect(command.match({ text: 'próximo passo', ownerJid: OWNER_JID })).toBe(true);
  });

  it('não reconhece formulação livre fora do vocabulário fixo', () => {
    const { commands } = buildCommands();
    const command = findCommand(commands, 'next-action.query');

    expect(command.match({ text: 'me conta uma piada', ownerJid: OWNER_JID })).toBe(false);
  });

  it('devolve exatamente 1 ação com vários itens ativos', async () => {
    const { service, commands } = buildCommands();
    service.create({ type: 'tarefa', title: 'pagar boleto', origin: 'texto', dueAt: new Date('2026-08-26T10:00:00.000Z') });
    service.create({ type: 'tarefa', title: 'revisar contrato', origin: 'texto', dueAt: new Date('2026-08-30T10:00:00.000Z') });

    const command = findCommand(commands, 'next-action.query');
    const result = await command.handle({ text: 'qual a proxima', ownerJid: OWNER_JID });

    expect(result.replyText).toBe('pagar boleto');
  });

  it('sem item ativo elegível, resposta honesta e curta — nunca "não entendi"', async () => {
    const { commands } = buildCommands();
    const command = findCommand(commands, 'next-action.query');

    const result = await command.handle({ text: 'qual a proxima', ownerJid: OWNER_JID });

    expect(result.replyText.toLowerCase()).not.toContain('não entendi');
    expect(result.replyText.toLowerCase()).toContain('nada pendente');
  });

  it('nunca degrada para listar tudo — resposta é sempre uma única linha, o título da ação', async () => {
    const { service, commands } = buildCommands();
    service.create({ type: 'tarefa', title: 'item 1', origin: 'texto' });
    service.create({ type: 'tarefa', title: 'item 2', origin: 'texto' });

    const command = findCommand(commands, 'next-action.query');
    const result = await command.handle({ text: 'próximo passo', ownerJid: OWNER_JID });

    expect(result.replyText.split('\n')).toHaveLength(1);
  });
});
