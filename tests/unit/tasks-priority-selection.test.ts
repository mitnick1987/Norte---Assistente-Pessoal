import { describe, expect, it } from 'vitest';
import { selectTopPriorities, type PrioritizableItem } from '../../src/modules/tasks/public/index.js';

function item(overrides: Partial<PrioritizableItem> & { id: number }): PrioritizableItem {
  return { title: `item ${overrides.id}`, priority: null, dueAt: null, ...overrides };
}

/**
 * Critério compartilhado por `rituals` (briefing) e `next-action` ("qual a
 * próxima?") desde a FEAT-007 — vive em `tasks/domain` para os dois módulos
 * importarem o mesmo comportamento sem depender de interno um do outro
 * (spec FEAT-007, Decisões tomadas).
 */
describe('selectTopPriorities (tasks/domain, critério compartilhado por rituals e next-action)', () => {
  it('seleciona até maxCount itens ordenados por prazo mais próximo primeiro', () => {
    const items = [
      item({ id: 1, dueAt: '2026-09-02T10:00:00.000Z' }),
      item({ id: 2, dueAt: '2026-09-01T10:00:00.000Z' }),
      item({ id: 3, dueAt: '2026-09-03T10:00:00.000Z' }),
      item({ id: 4, dueAt: '2026-09-04T10:00:00.000Z' }),
    ];

    const top = selectTopPriorities(items, 3);

    expect(top.map((i) => i.id)).toEqual([2, 1, 3]);
  });

  it('item sem prazo vai depois de qualquer item com prazo', () => {
    const items = [item({ id: 1, dueAt: null }), item({ id: 2, dueAt: '2026-09-01T10:00:00.000Z' })];

    const top = selectTopPriorities(items, 2);

    expect(top.map((i) => i.id)).toEqual([2, 1]);
  });

  it('desempate por prioridade explícita (1 mais urgente) quando prazos são iguais', () => {
    const items = [
      item({ id: 1, dueAt: '2026-09-01T10:00:00.000Z', priority: 3 }),
      item({ id: 2, dueAt: '2026-09-01T10:00:00.000Z', priority: 1 }),
    ];

    const top = selectTopPriorities(items, 2);

    expect(top.map((i) => i.id)).toEqual([2, 1]);
  });

  it('desempate final por id quando prazo e prioridade coincidem', () => {
    const items = [
      item({ id: 5, dueAt: '2026-09-01T10:00:00.000Z', priority: 2 }),
      item({ id: 2, dueAt: '2026-09-01T10:00:00.000Z', priority: 2 }),
    ];

    const top = selectTopPriorities(items, 2);

    expect(top.map((i) => i.id)).toEqual([2, 5]);
  });

  it('mesmo estado do task-store sempre produz a mesma seleção (determinístico)', () => {
    const items = [item({ id: 3 }), item({ id: 1 }), item({ id: 2 })];

    const first = selectTopPriorities(items, 3).map((i) => i.id);
    const second = selectTopPriorities(items, 3).map((i) => i.id);

    expect(first).toEqual(second);
  });

  it('nunca retorna mais que maxCount mesmo com muitos itens elegíveis', () => {
    const items = Array.from({ length: 10 }, (_, i) => item({ id: i + 1 }));

    expect(selectTopPriorities(items, 3)).toHaveLength(3);
  });

  it('lista vazia devolve seleção vazia, nunca lança', () => {
    expect(selectTopPriorities([], 3)).toEqual([]);
  });
});
