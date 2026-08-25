import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/core/db/migrator.js';
import { tasksMigrations } from '../../src/modules/tasks/migrations/index.js';
import { ItemsRepository } from '../../src/modules/tasks/items-repository.js';
import { ItemService, ItemNotFoundError } from '../../src/modules/tasks/item-service.js';
import { InvalidStatusTransitionError } from '../../src/modules/tasks/domain/index.js';

const FIXED_NOW = new Date('2026-08-25T13:00:00.000Z'); // terça 10h em America/Sao_Paulo

function buildService(): ItemService {
  const db = new Database(':memory:');
  runMigrations(db, tasksMigrations);
  return new ItemService(new ItemsRepository(db), () => FIXED_NOW);
}

describe('ItemService', () => {
  it('create com status default "ativa" quando não ambíguo', () => {
    const service = buildService();

    const item = service.create({ type: 'nota', title: 'ideia solta', origin: 'texto' });

    expect(item.status).toBe('ativa');
  });

  it('create respeita status "inbox" explícito (classificação ambígua, RF-01)', () => {
    const service = buildService();

    const item = service.create({ type: 'tarefa', title: 'algo incerto', origin: 'texto', status: 'inbox' });

    expect(item.status).toBe('inbox');
  });

  it('complete transiciona para feita', () => {
    const service = buildService();
    const item = service.create({ type: 'tarefa', title: 'x', origin: 'texto' });

    const result = service.complete(item.id);

    expect(result.status).toBe('feita');
  });

  it('complete de item já feito lança InvalidStatusTransitionError', () => {
    const service = buildService();
    const item = service.create({ type: 'tarefa', title: 'x', origin: 'texto' });
    service.complete(item.id);

    expect(() => service.complete(item.id)).toThrow(InvalidStatusTransitionError);
  });

  it('complete de item inexistente lança ItemNotFoundError', () => {
    const service = buildService();

    expect(() => service.complete(999)).toThrow(ItemNotFoundError);
  });

  it('drop sempre lógico — nunca remove a linha (ADR-009)', () => {
    const service = buildService();
    const item = service.create({ type: 'tarefa', title: 'x', origin: 'texto' });

    const result = service.drop(item.id);

    expect(result.status).toBe('dropada');
  });

  it('archive transiciona para arquivada (usado futuramente por hygiene, RF-11)', () => {
    const service = buildService();
    const item = service.create({ type: 'tarefa', title: 'x', origin: 'texto' });

    const result = service.archive(item.id);

    expect(result.status).toBe('arquivada');
  });

  it('snoozeByText resolve data relativa e transiciona para adiada', () => {
    const service = buildService();
    const item = service.create({ type: 'tarefa', title: 'x', origin: 'texto' });

    const result = service.snoozeByText(item.id, 'sexta');

    expect(result?.status).toBe('adiada');
    expect(result?.dueAt).toBe('2026-08-28T12:00:00.000Z');
  });

  it('snoozeByText retorna undefined quando o texto não tem data reconhecível', () => {
    const service = buildService();
    const item = service.create({ type: 'tarefa', title: 'x', origin: 'texto' });

    const result = service.snoozeByText(item.id, 'não sei quando');

    expect(result).toBeUndefined();
  });

  it('list nunca inclui itens em inbox por padrão', () => {
    const service = buildService();
    service.create({ type: 'tarefa', title: 'ambígua', origin: 'texto', status: 'inbox' });
    service.create({ type: 'tarefa', title: 'clara', origin: 'texto' });

    const items = service.list();

    expect(items.map((i) => i.title)).toEqual(['clara']);
  });

  it('list inclui inbox quando includeInbox é true', () => {
    const service = buildService();
    service.create({ type: 'tarefa', title: 'ambígua', origin: 'texto', status: 'inbox' });

    const items = service.list({ includeInbox: true });

    expect(items.map((i) => i.title)).toContain('ambígua');
  });
});
