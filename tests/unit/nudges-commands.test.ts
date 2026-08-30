import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/core/db/migrator.js';
import { coreMigrations } from '../../src/core/db/migrations/index.js';
import { tasksMigrations } from '../../src/modules/tasks/migrations/index.js';
import { nudgesMigrations } from '../../src/modules/nudges/migrations/index.js';
import { ItemsRepository } from '../../src/modules/tasks/items-repository.js';
import { ItemService } from '../../src/modules/tasks/item-service.js';
import { OutboxRepository } from '../../src/core/outbox/index.js';
import { MessageRepository } from '../../src/core/channel/index.js';
import { PendingMenuRepository } from '../../src/core/menu/index.js';
import { ChargesRepository } from '../../src/modules/nudges/charges-repository.js';
import { PatternsRepository } from '../../src/modules/nudges/patterns-repository.js';
import { NudgeService } from '../../src/modules/nudges/nudge-service.js';
import { ReturnModeService } from '../../src/modules/return-mode/return-mode-service.js';
import { buildNudgesCommands } from '../../src/modules/nudges/commands.js';

const OWNER_JID = '5511999999999@s.whatsapp.net';
const NOW = new Date('2026-08-30T15:00:00.000Z');
const noopLogger = { info: () => undefined, warn: () => undefined, error: () => undefined } as never;

function buildContext() {
  const db = new Database(':memory:');
  runMigrations(db, [...coreMigrations, ...tasksMigrations, ...nudgesMigrations]);

  const itemService = new ItemService(new ItemsRepository(db), () => NOW);
  const outboxRepository = new OutboxRepository(db);
  const messageRepository = new MessageRepository(db);
  const pendingMenuRepository = new PendingMenuRepository(db);
  const returnModeService = new ReturnModeService({ messageRepository, itemService, now: () => NOW });
  const nudgeService = new NudgeService({
    itemService,
    chargesRepository: new ChargesRepository(db),
    patternsRepository: new PatternsRepository(db),
    outboxRepository,
    pendingMenuRepository,
    returnModeService,
    ownerJid: OWNER_JID,
    logger: noopLogger,
    getDailyChargeCap: () => 3,
    getDailyProactiveCap: () => 6,
    getFallbackSnoozeHour: () => 9,
    getFallbackSnoozeMinute: () => 0,
    now: () => NOW,
  });

  const commands = buildNudgesCommands(itemService, nudgeService);
  return { db, itemService, pendingMenuRepository, nudgeService, commands };
}

function findCommand(commands: ReturnType<typeof buildNudgesCommands>, name: string) {
  const command = commands.find((c) => c.name === name);
  if (!command) throw new Error(`command ${name} não encontrado`);
  return command;
}

describe('comandos de resposta à cobrança (RF-08, menu 1/2/3)', () => {
  it('"1" só bate quando há cobrança pendente', async () => {
    const { commands } = buildContext();
    const command = findCommand(commands, 'nudges.charge.complete');

    expect(command.match({ text: '1', ownerJid: OWNER_JID })).toBe(false);
  });

  it('"1" completa o item cobrado', async () => {
    const { itemService, nudgeService, commands } = buildContext();
    const item = itemService.create({
      type: 'tarefa',
      title: 'pagar boleto',
      origin: 'texto',
      dueAt: new Date('2026-08-30T10:00:00.000Z'),
    });
    await nudgeService.checkAndSendDue();

    const command = findCommand(commands, 'nudges.charge.complete');
    expect(command.match({ text: '1', ownerJid: OWNER_JID })).toBe(true);
    await command.handle({ text: '1', ownerJid: OWNER_JID });

    const [found] = itemService.list({ includeInbox: true }).filter((i) => i.id === item.id);
    expect(found).toBeUndefined(); // não está mais ativo (status feita)
  });

  it('"3" dropa o item cobrado (deleção lógica)', async () => {
    const { db, itemService, nudgeService, commands } = buildContext();
    const item = itemService.create({
      type: 'tarefa',
      title: 'pagar boleto',
      origin: 'texto',
      dueAt: new Date('2026-08-30T10:00:00.000Z'),
    });
    await nudgeService.checkAndSendDue();

    const command = findCommand(commands, 'nudges.charge.drop');
    await command.handle({ text: '3', ownerJid: OWNER_JID });

    const row = db.prepare('SELECT status FROM items WHERE id = ?').get(item.id) as { status: string };
    expect(row.status).toBe('dropada');
  });

  it('"2" gera proposta de horário concreto, nunca pergunta "para quando?"', async () => {
    const { itemService, nudgeService, commands } = buildContext();
    itemService.create({ type: 'tarefa', title: 'pagar boleto', origin: 'texto', dueAt: new Date('2026-08-30T10:00:00.000Z') });
    await nudgeService.checkAndSendDue();

    const command = findCommand(commands, 'nudges.charge.reschedule');
    const result = await command.handle({ text: '2', ownerJid: OWNER_JID });

    expect(result.replyText.toLowerCase()).not.toContain('para quando');
  });

  it('depois de responder, a mesma cobrança não pode ser respondida de novo (sem cobrança pendente)', async () => {
    const { itemService, nudgeService, commands } = buildContext();
    itemService.create({ type: 'tarefa', title: 'pagar boleto', origin: 'texto', dueAt: new Date('2026-08-30T10:00:00.000Z') });
    await nudgeService.checkAndSendDue();

    const completeCommand = findCommand(commands, 'nudges.charge.complete');
    await completeCommand.handle({ text: '1', ownerJid: OWNER_JID });

    expect(completeCommand.match({ text: '1', ownerJid: OWNER_JID })).toBe(false);
  });

  /**
   * Achado de review (security-auditor): o item cobrado pode virar terminal
   * por outro caminho (linguagem natural, brain) ANTES da resposta numérica
   * chegar. Sem a checagem de estado terminal, `itemService.complete`
   * lançava `InvalidStatusTransitionError`, a exceção subia até o `.catch` do
   * webhook (mensagem marcada `failed`, dono sem resposta) e o charge nunca
   * era marcado como respondido — travando o menu 1/2/3 pra sempre (
   * `findMostRecentPending` continuava devolvendo o mesmo charge morto).
   */
  it('item cobrado já em estado terminal (feita) antes da resposta chegar: "1" resolve graciosamente, sem lançar', async () => {
    const { itemService, nudgeService, commands } = buildContext();
    const item = itemService.create({
      type: 'tarefa',
      title: 'pagar boleto',
      origin: 'texto',
      dueAt: new Date('2026-08-30T10:00:00.000Z'),
    });
    await nudgeService.checkAndSendDue();

    // corrida: o dono completa o item por outro caminho (linguagem natural)
    // antes de responder "1" à cobrança.
    itemService.complete(item.id);

    const command = findCommand(commands, 'nudges.charge.complete');
    expect(command.match({ text: '1', ownerJid: OWNER_JID })).toBe(true);

    const result = await command.handle({ text: '1', ownerJid: OWNER_JID });

    expect(result.replyText).toBeTruthy();
    expect(result.replyText.toLowerCase()).not.toMatch(/erro|falha|exception/);
  });

  it('item cobrado já em estado terminal: a cobrança é encerrada (não trava o menu 1/2/3 pra sempre)', async () => {
    const { itemService, nudgeService, commands } = buildContext();
    const item = itemService.create({
      type: 'tarefa',
      title: 'pagar boleto',
      origin: 'texto',
      dueAt: new Date('2026-08-30T10:00:00.000Z'),
    });
    await nudgeService.checkAndSendDue();
    itemService.complete(item.id);

    const completeCommand = findCommand(commands, 'nudges.charge.complete');
    await completeCommand.handle({ text: '1', ownerJid: OWNER_JID });

    // charge foi encerrado — "1" não bate mais (nenhum menu 1/2/3 fica preso
    // resolvendo pra sempre contra um item terminal).
    expect(completeCommand.match({ text: '1', ownerJid: OWNER_JID })).toBe(false);
  });

  it('item cobrado já dropado antes da resposta chegar: "3" (dropar de novo) resolve graciosamente, sem lançar', async () => {
    const { itemService, nudgeService, commands } = buildContext();
    const item = itemService.create({
      type: 'tarefa',
      title: 'pagar boleto',
      origin: 'texto',
      dueAt: new Date('2026-08-30T10:00:00.000Z'),
    });
    await nudgeService.checkAndSendDue();
    await itemService.drop(item.id);

    const command = findCommand(commands, 'nudges.charge.drop');
    const result = await command.handle({ text: '3', ownerJid: OWNER_JID });

    expect(result.replyText).toBeTruthy();
  });

  it('item cobrado já em estado terminal: "2" (reagendar) resolve graciosamente, nunca tenta aplicar snooze num item terminal', async () => {
    const { itemService, nudgeService, commands } = buildContext();
    const item = itemService.create({
      type: 'tarefa',
      title: 'pagar boleto',
      origin: 'texto',
      dueAt: new Date('2026-08-30T10:00:00.000Z'),
    });
    await nudgeService.checkAndSendDue();
    itemService.complete(item.id);

    const command = findCommand(commands, 'nudges.charge.reschedule');
    const result = await command.handle({ text: '2', ownerJid: OWNER_JID });

    expect(result.replyText).toBeTruthy();
    const row = itemService.findById(item.id);
    expect(row?.status).toBe('feita'); // nunca virou "adiada" por cima do estado terminal
  });
});
