import { describe, expect, it } from 'vitest';
import { selectNextAction } from '../../src/modules/next-action/domain/index.js';
import type { PrioritizableItem } from '../../src/modules/tasks/public/index.js';

function item(overrides: Partial<PrioritizableItem> & { id: number }): PrioritizableItem {
  return { title: `item ${overrides.id}`, priority: null, dueAt: null, ...overrides };
}

describe('selectNextAction (RF-09, sempre UMA ação, nunca lista)', () => {
  it('devolve exatamente 1 item para um conjunto com vários candidatos', () => {
    const items = [
      item({ id: 1, dueAt: '2026-09-02T10:00:00.000Z' }),
      item({ id: 2, dueAt: '2026-09-01T10:00:00.000Z' }),
      item({ id: 3, dueAt: '2026-09-03T10:00:00.000Z' }),
    ];

    const next = selectNextAction(items);

    expect(next?.id).toBe(2);
  });

  it('critério idêntico ao briefing: prazo mais próximo primeiro', () => {
    const items = [item({ id: 1, dueAt: '2026-09-05T10:00:00.000Z' }), item({ id: 2, dueAt: '2026-09-01T10:00:00.000Z' })];

    expect(selectNextAction(items)?.id).toBe(2);
  });

  it('desempate por prioridade explícita quando o prazo é igual', () => {
    const items = [
      item({ id: 1, dueAt: '2026-09-01T10:00:00.000Z', priority: 3 }),
      item({ id: 2, dueAt: '2026-09-01T10:00:00.000Z', priority: 1 }),
    ];

    expect(selectNextAction(items)?.id).toBe(2);
  });

  it('desempate final por id quando prazo e prioridade coincidem', () => {
    const items = [
      item({ id: 5, dueAt: '2026-09-01T10:00:00.000Z' }),
      item({ id: 2, dueAt: '2026-09-01T10:00:00.000Z' }),
    ];

    expect(selectNextAction(items)?.id).toBe(2);
  });

  it('nenhum item ativo elegível devolve undefined, nunca lista parcial', () => {
    expect(selectNextAction([])).toBeUndefined();
  });
});
