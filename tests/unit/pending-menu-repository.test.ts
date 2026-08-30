import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/core/db/migrator.js';
import { coreMigrations } from '../../src/core/db/migrations/index.js';
import { PendingMenuRepository } from '../../src/core/menu/index.js';

function buildRepository() {
  const db = new Database(':memory:');
  runMigrations(db, coreMigrations);
  return { db, repository: new PendingMenuRepository(db) };
}

describe('PendingMenuRepository (achado de review, FEAT-007)', () => {
  it('findMostRecentPending devolve undefined sem nenhum registro', () => {
    const { repository } = buildRepository();

    expect(repository.findMostRecentPending()).toBeUndefined();
  });

  it('findMostRecentPending devolve o registro mais recente ainda sem resposta', () => {
    const { repository } = buildRepository();
    repository.record('cobranca', 1);
    const secondId = repository.record('revisao', 2);

    const pending = repository.findMostRecentPending();

    expect(pending?.id).toBe(secondId);
    expect(pending?.origin).toBe('revisao');
    expect(pending?.itemId).toBe(2);
  });

  it('markResolved remove o registro da lista de pendentes, voltando ao anterior ainda não resolvido', () => {
    const { repository } = buildRepository();
    repository.record('cobranca', 1);
    const secondId = repository.record('higiene', 2);

    repository.markResolved(secondId, new Date());

    const pending = repository.findMostRecentPending();
    expect(pending?.origin).toBe('cobranca');
    expect(pending?.itemId).toBe(1);
  });

  it('todos resolvidos: findMostRecentPending devolve undefined', () => {
    const { repository } = buildRepository();
    const id = repository.record('cobranca', 1);

    repository.markResolved(id, new Date());

    expect(repository.findMostRecentPending()).toBeUndefined();
  });

  it('rejeita origin fora do vocabulário fechado (CHECK constraint)', () => {
    const { db } = buildRepository();

    expect(() =>
      db.prepare(`INSERT INTO pending_menus (origin, item_id) VALUES ('outra-coisa', 1)`).run(),
    ).toThrow();
  });
});
