import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/core/db/migrator.js';
import { tasksMigrations } from '../../src/modules/tasks/migrations/index.js';
import { ItemsRepository } from '../../src/modules/tasks/items-repository.js';
import { ItemService } from '../../src/modules/tasks/item-service.js';
import { buildTasksCommands } from '../../src/modules/tasks/commands.js';

const FIXED_NOW = new Date('2026-08-25T13:00:00.000Z');
const OWNER_JID = '5511999999999@s.whatsapp.net';

function buildCommands() {
  const db = new Database(':memory:');
  runMigrations(db, tasksMigrations);
  const service = new ItemService(new ItemsRepository(db), () => FIXED_NOW);
  return { service, commands: buildTasksCommands(service) };
}

function findCommand(commands: ReturnType<typeof buildTasksCommands>, name: string) {
  const command = commands.find((c) => c.name === name);
  if (!command) throw new Error(`command ${name} não encontrado`);
  return command;
}

describe('executor determinístico de comandos (RF-07)', () => {
  it('"feito" completa o item mais recente ativo', async () => {
    const { service, commands } = buildCommands();
    service.create({ type: 'tarefa', title: 'pagar boleto', origin: 'texto' });

    const complete = findCommand(commands, 'tasks.complete');
    expect(complete.match({ text: 'feito', ownerJid: OWNER_JID })).toBe(true);

    const result = await complete.handle({ text: 'feito', ownerJid: OWNER_JID });

    expect(result.replyText).not.toMatch(/pergunta|qual|projeto|prazo/i);
    const [item] = service.list({ includeInbox: true });
    expect(item).toBeUndefined(); // já não está mais ativo (status feita)
  });

  it('"feito" sem item ativo responde honestamente, sem inventar item', async () => {
    const { commands } = buildCommands();
    const complete = findCommand(commands, 'tasks.complete');

    const result = await complete.handle({ text: 'feito', ownerJid: OWNER_JID });

    expect(result.replyText).toMatch(/não achei/i);
  });

  it('"dropa" dropa o item mais recente (deleção lógica)', async () => {
    const { service, commands } = buildCommands();
    const item = service.create({ type: 'tarefa', title: 'x', origin: 'texto' });

    const drop = findCommand(commands, 'tasks.drop');
    await drop.handle({ text: 'dropa', ownerJid: OWNER_JID });

    const updated = service.list({ includeInbox: true }).find((i) => i.id === item.id);
    expect(updated).toBeUndefined();
  });

  it('"dropa" sem item ativo responde honestamente, sem inventar item', async () => {
    const { commands } = buildCommands();
    const drop = findCommand(commands, 'tasks.drop');

    const result = await drop.handle({ text: 'dropa', ownerJid: OWNER_JID });

    expect(result.replyText).toMatch(/não achei/i);
  });

  it('"adia sexta" resolve a data e adia o item mais recente', async () => {
    const { service, commands } = buildCommands();
    const item = service.create({ type: 'tarefa', title: 'x', origin: 'texto' });

    const snooze = findCommand(commands, 'tasks.snooze');
    expect(snooze.match({ text: 'adia sexta', ownerJid: OWNER_JID })).toBe(true);
    await snooze.handle({ text: 'adia sexta', ownerJid: OWNER_JID });

    const found = service.list({ includeInbox: true }).find((i) => i.id === item.id);
    expect(found?.status).toBe('adiada');
  });

  it('segundo "adia" sobre item já adiado re-adia e responde normalmente, sem exceção nem silêncio', async () => {
    const { service, commands } = buildCommands();
    const item = service.create({ type: 'tarefa', title: 'x', origin: 'texto' });

    const snooze = findCommand(commands, 'tasks.snooze');
    await snooze.handle({ text: 'adia sexta', ownerJid: OWNER_JID });

    const result = await snooze.handle({ text: 'adia segunda que vem', ownerJid: OWNER_JID });

    expect(result.replyText).toBe('Adiei.');
    const found = service.list({ includeInbox: true }).find((i) => i.id === item.id);
    expect(found?.status).toBe('adiada');
  });

  it('"adia" com data não reconhecida não altera o item e responde honestamente', async () => {
    const { service, commands } = buildCommands();
    const item = service.create({ type: 'tarefa', title: 'x', origin: 'texto' });

    const snooze = findCommand(commands, 'tasks.snooze');
    const result = await snooze.handle({ text: 'adia lá pelas tantas', ownerJid: OWNER_JID });

    expect(result.replyText).toMatch(/não entendi/i);
    const found = service.list({ includeInbox: true }).find((i) => i.id === item.id);
    expect(found?.status).toBe('ativa');
  });

  it('"adia" sem item ativo responde honestamente, sem inventar item', async () => {
    const { commands } = buildCommands();
    const snooze = findCommand(commands, 'tasks.snooze');

    const result = await snooze.handle({ text: 'adia sexta', ownerJid: OWNER_JID });

    expect(result.replyText).toMatch(/não achei/i);
  });

  it('"lista" mostra os itens ativos sem nenhuma referência a contagem de adiamentos', async () => {
    const { service, commands } = buildCommands();
    service.create({ type: 'tarefa', title: 'pagar boleto', origin: 'texto' });

    const list = findCommand(commands, 'tasks.list');
    const result = await list.handle({ text: 'me mostra tudo', ownerJid: OWNER_JID });

    expect(result.replyText).toContain('pagar boleto');
    expect(result.replyText).not.toMatch(/adi(a|ou|amento)/i);
  });

  it('"lista" com lista vazia responde sem erro', async () => {
    const { commands } = buildCommands();
    const list = findCommand(commands, 'tasks.list');

    const result = await list.handle({ text: 'lista', ownerJid: OWNER_JID });

    expect(result.replyText).toMatch(/vazia/i);
  });

  it('"lista" mostra a data formatada em pt-BR para itens com dueAt', async () => {
    const { service, commands } = buildCommands();
    service.create({
      type: 'compromisso',
      title: 'dentista',
      origin: 'texto',
      dueAt: new Date('2026-08-28T17:00:00.000Z'),
    });

    const list = findCommand(commands, 'tasks.list');
    const result = await list.handle({ text: 'lista', ownerJid: OWNER_JID });

    expect(result.replyText).toContain('dentista');
    expect(result.replyText).toMatch(/28\/08.*14:00/);
  });
});
