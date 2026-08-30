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

  describe('listByStatusUpdatedBetween', () => {
    // Janela alinhada à meia-noite UTC (formato `YYYY-MM-DDT00:00:00.000Z`,
    // igual ao que briefing/revisão calculam a partir do dia civil de
    // America/Sao_Paulo) é o cenário que expõe o bug original: comparar essa
    // string ISO direto contra `updated_at` gravado por `datetime('now')`
    // (`YYYY-MM-DD HH:MM:SS`, sem `T`) falha lexicograficamente porque
    // ' ' (0x20) < 'T' (0x54) no índice 10 — uma janela `±24h` a partir de
    // `Date.now()` não pega isso de forma confiável (o dígito do dia pode
    // mascarar o problema dependendo da hora em que o teste roda).
    function todayUtcWindow(): { since: Date; until: Date } {
      const now = new Date();
      const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      const until = new Date(since.getTime() + 24 * 60 * 60 * 1000);
      return { since, until };
    }

    it('inclui item concluído agora (updateStatus real, updated_at gravado por datetime(\'now\')) na janela do dia civil de hoje', () => {
      const { repository } = buildRepository();
      const item = repository.create({ type: 'tarefa', title: 'pagar boleto', origin: 'texto', status: 'ativa' });

      repository.updateStatus(item.id, 'feita');

      const { since, until } = todayUtcWindow();
      const result = repository.listByStatusUpdatedBetween('feita', since, until);

      expect(result.map((i) => i.id)).toEqual([item.id]);
    });

    it('inclui item reagendado agora (snooze real) na janela do dia civil de hoje', () => {
      const { repository } = buildRepository();
      const item = repository.create({ type: 'tarefa', title: 'remarcar', origin: 'texto', status: 'ativa' });

      repository.snooze(item.id, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));

      const { since, until } = todayUtcWindow();
      const result = repository.listByStatusUpdatedBetween('adiada', since, until);

      expect(result.map((i) => i.id)).toEqual([item.id]);
    });

    it('exclui item cujo status bate mas foi atualizado fora da janela', () => {
      const { repository } = buildRepository();
      const item = repository.create({ type: 'tarefa', title: 'antigo', origin: 'texto', status: 'ativa' });
      repository.updateStatus(item.id, 'feita');

      // janela inteira no passado — o item foi concluído "agora", não nela.
      const since = new Date(Date.now() - 48 * 60 * 60 * 1000);
      const until = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const result = repository.listByStatusUpdatedBetween('feita', since, until);

      expect(result).toEqual([]);
    });

    it('exclui item com status diferente do pedido mesmo dentro da janela', () => {
      const { repository } = buildRepository();
      const item = repository.create({ type: 'tarefa', title: 'em andamento', origin: 'texto', status: 'ativa' });
      repository.updateStatus(item.id, 'em_andamento');

      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const until = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const result = repository.listByStatusUpdatedBetween('feita', since, until);

      expect(result.map((i) => i.id)).not.toContain(item.id);
    });
  });
});
