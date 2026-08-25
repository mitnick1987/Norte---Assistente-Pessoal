import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/core/db/migrator.js';
import { tasksMigrations } from '../../src/modules/tasks/migrations/index.js';
import { ItemsRepository } from '../../src/modules/tasks/items-repository.js';

function buildRepository(): { db: Database.Database; repository: ItemsRepository } {
  const db = new Database(':memory:');
  runMigrations(db, tasksMigrations);
  return { db, repository: new ItemsRepository(db) };
}

describe('ItemsRepository', () => {
  it('cria item com status inicial e snoozeCount zerado', () => {
    const { repository } = buildRepository();

    const item = repository.create({ type: 'tarefa', title: 'pagar boleto', origin: 'texto', status: 'ativa' });

    expect(item).toMatchObject({ type: 'tarefa', title: 'pagar boleto', status: 'ativa', snoozeCount: 0 });
  });

  it('dropar via updateStatus nunca remove a linha (deleção lógica, ADR-009)', () => {
    const { db, repository } = buildRepository();
    const item = repository.create({ type: 'tarefa', title: 'x', origin: 'texto', status: 'ativa' });

    repository.updateStatus(item.id, 'dropada');

    const row = db.prepare('SELECT status FROM items WHERE id = ?').get(item.id) as { status: string };
    expect(row.status).toBe('dropada');
    const count = db.prepare('SELECT COUNT(*) as c FROM items').get() as { c: number };
    expect(count.c).toBe(1);
  });

  it('snooze incrementa snoozeCount e atualiza due_at', () => {
    const { repository } = buildRepository();
    const item = repository.create({ type: 'tarefa', title: 'x', origin: 'texto', status: 'ativa' });

    const newDueAt = new Date('2026-09-01T12:00:00.000Z');
    const result = repository.snooze(item.id, newDueAt);

    expect(result.snoozeCount).toBe(1);
    expect(result.status).toBe('adiada');
    expect(result.dueAt).toBe(newDueAt.toISOString());
  });

  it('snooze repetido acumula a contagem', () => {
    const { repository } = buildRepository();
    const item = repository.create({ type: 'tarefa', title: 'x', origin: 'texto', status: 'ativa' });

    repository.snooze(item.id, new Date('2026-09-01T12:00:00.000Z'));
    const result = repository.snooze(item.id, new Date('2026-09-08T12:00:00.000Z'));

    expect(result.snoozeCount).toBe(2);
  });

  it('list sem filtro retorna todos os itens ordenados por due_at', () => {
    const { repository } = buildRepository();
    repository.create({ type: 'tarefa', title: 'sem prazo', origin: 'texto', status: 'ativa' });
    repository.create({
      type: 'tarefa',
      title: 'com prazo',
      origin: 'texto',
      status: 'ativa',
      dueAt: new Date('2026-08-26T12:00:00.000Z'),
    });

    const items = repository.list();

    expect(items.map((i) => i.title)).toEqual(['com prazo', 'sem prazo']);
  });

  it('list filtra por status quando informado', () => {
    const { repository } = buildRepository();
    const a = repository.create({ type: 'tarefa', title: 'a', origin: 'texto', status: 'ativa' });
    repository.create({ type: 'tarefa', title: 'b', origin: 'texto', status: 'inbox' });
    repository.updateStatus(a.id, 'feita');

    const items = repository.list({ statuses: ['inbox'] });

    expect(items.map((i) => i.title)).toEqual(['b']);
  });

  it('findMostRecentActive ignora itens feitos/arquivados/dropados', () => {
    const { repository } = buildRepository();
    const first = repository.create({ type: 'tarefa', title: 'primeiro', origin: 'texto', status: 'ativa' });
    repository.updateStatus(first.id, 'feita');

    const second = repository.create({ type: 'tarefa', title: 'segundo', origin: 'texto', status: 'ativa' });

    const result = repository.findMostRecentActive();

    expect(result?.id).toBe(second.id);
  });

  it('findMostRecentActive retorna undefined quando não há item ativo', () => {
    const { repository } = buildRepository();

    expect(repository.findMostRecentActive()).toBeUndefined();
  });
});
