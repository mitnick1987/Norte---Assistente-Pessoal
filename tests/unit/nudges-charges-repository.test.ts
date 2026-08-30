import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/core/db/migrator.js';
import { nudgesMigrations } from '../../src/modules/nudges/migrations/index.js';
import { ChargesRepository } from '../../src/modules/nudges/charges-repository.js';

function buildRepository() {
  const db = new Database(':memory:');
  runMigrations(db, nudgesMigrations);
  return { db, repository: new ChargesRepository(db) };
}

describe('ChargesRepository', () => {
  it('countChargedOn conta só as cobranças do dia informado', () => {
    const { repository } = buildRepository();
    repository.record(1, '2026-08-30');
    repository.record(2, '2026-08-30');
    repository.record(3, '2026-08-29');

    expect(repository.countChargedOn('2026-08-30')).toBe(2);
    expect(repository.countChargedOn('2026-08-29')).toBe(1);
  });

  it('findItemIdsChargedOn devolve o conjunto de ids cobrados no dia', () => {
    const { repository } = buildRepository();
    repository.record(1, '2026-08-30');
    repository.record(2, '2026-08-30');

    expect(repository.findItemIdsChargedOn('2026-08-30')).toEqual(new Set([1, 2]));
  });

  it('findMostRecentPending devolve a cobrança mais recente ainda sem resposta', () => {
    const { repository } = buildRepository();
    repository.record(1, '2026-08-30');
    repository.record(2, '2026-08-30');

    const pending = repository.findMostRecentPending();

    expect(pending?.itemId).toBe(2);
  });

  it('findMostRecentPending devolve undefined quando todas já foram respondidas', () => {
    const { repository } = buildRepository();
    const id = repository.record(1, '2026-08-30');
    repository.markResponded(id, new Date('2026-08-30T15:00:00.000Z'));

    expect(repository.findMostRecentPending()).toBeUndefined();
  });

  it('markResponded grava responded_at e remove a cobrança da lista de pendentes', () => {
    const { db, repository } = buildRepository();
    const id = repository.record(1, '2026-08-30');

    repository.markResponded(id, new Date('2026-08-30T15:00:00.000Z'));

    const row = db.prepare('SELECT responded_at FROM nudges_charges WHERE id = ?').get(id) as {
      responded_at: string | null;
    };
    expect(row.responded_at).not.toBeNull();
  });
});
