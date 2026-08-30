import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/core/db/migrator.js';
import { nudgesMigrations } from '../../src/modules/nudges/migrations/index.js';
import { PatternsRepository } from '../../src/modules/nudges/patterns-repository.js';

function buildRepository() {
  const db = new Database(':memory:');
  runMigrations(db, nudgesMigrations);
  return { db, repository: new PatternsRepository(db) };
}

describe('PatternsRepository (ARCHITECTURE.md §3, ER: patterns)', () => {
  it('sem nenhuma amostra gravada, findRecentResponseWindows devolve lista vazia', () => {
    const { repository } = buildRepository();

    expect(repository.findRecentResponseWindows(10)).toEqual([]);
  });

  it('grava e lê amostras de janela de resposta', () => {
    const { repository } = buildRepository();
    repository.recordResponseWindow(6, 9);
    repository.recordResponseWindow(2, 14);

    const windows = repository.findRecentResponseWindows(10);

    expect(windows).toHaveLength(2);
    expect(windows).toContainEqual({ weekday: 6, hour: 9 });
  });

  it('respeita o limite pedido, mesmo com mais amostras gravadas', () => {
    const { repository } = buildRepository();
    for (let i = 0; i < 5; i++) repository.recordResponseWindow(i % 7, 9);

    expect(repository.findRecentResponseWindows(3)).toHaveLength(3);
  });

  it('linha com valor corrompido é ignorada silenciosamente, nunca derruba a leitura', () => {
    const { db, repository } = buildRepository();
    db.prepare(`INSERT INTO patterns (metrica, valor) VALUES ('janela_resposta_habitual', 'não é json')`).run();
    repository.recordResponseWindow(6, 9);

    expect(repository.findRecentResponseWindows(10)).toEqual([{ weekday: 6, hour: 9 }]);
  });
});
