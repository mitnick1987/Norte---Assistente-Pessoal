import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/core/db/migrator.js';
import { tasksMigrations } from '../../src/modules/tasks/migrations/index.js';
import { ItemsRepository } from '../../src/modules/tasks/items-repository.js';
import { ItemService } from '../../src/modules/tasks/item-service.js';
import { HygieneService } from '../../src/modules/hygiene/hygiene-service.js';

const NOW = new Date('2026-08-30T12:00:00.000Z');

function buildContext() {
  const db = new Database(':memory:');
  runMigrations(db, tasksMigrations);
  const itemService = new ItemService(new ItemsRepository(db), () => NOW);
  const service = new HygieneService({ itemService, now: () => NOW });
  return { db, itemService, service };
}

describe('HygieneService (RF-11)', () => {
  it('sem item elegível, nenhuma proposta', () => {
    const { itemService, service } = buildContext();
    itemService.create({ type: 'tarefa', title: 'item novo', origin: 'texto' });

    expect(service.findProposal()).toBeUndefined();
  });

  it('item com 3+ adiamentos gera proposta', async () => {
    const { itemService, service } = buildContext();
    const item = itemService.create({ type: 'tarefa', title: 'projeto parado', origin: 'texto' });
    await itemService.snoozeByText(item.id, 'amanha');
    await itemService.snoozeByText(item.id, 'sexta');
    await itemService.snoozeByText(item.id, 'segunda que vem');

    const proposal = service.findProposal();

    expect(proposal?.itemId).toBe(item.id);
  });

  it('mensagem final nunca inclui snoozeCount, mesmo com muitos adiamentos', async () => {
    const { itemService, service } = buildContext();
    const item = itemService.create({ type: 'tarefa', title: 'projeto parado', origin: 'texto' });
    await itemService.snoozeByText(item.id, 'amanha');
    await itemService.snoozeByText(item.id, 'sexta');
    await itemService.snoozeByText(item.id, 'segunda que vem');

    const proposal = service.findProposal()!;
    const message = service.buildMessage(proposal);

    expect(message).not.toMatch(/snooze/i);
    expect(message).not.toMatch(/\d+\s*(ª|a)\s*vez/i);
  });
});
