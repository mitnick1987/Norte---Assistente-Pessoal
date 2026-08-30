import { describe, expect, it } from 'vitest';
import { isNudgeEligible, selectNudgeEligible, type NudgeCandidateItem, type NudgeEligibilityContext } from '../../src/modules/nudges/domain/index.js';

const NOW = new Date('2026-08-30T15:00:00.000Z');

function item(overrides: Partial<NudgeCandidateItem> & { id: number }): NudgeCandidateItem {
  return {
    title: `item ${overrides.id}`,
    status: 'ativa',
    dueAt: null,
    isUnconfirmedTopPriority: false,
    ...overrides,
  };
}

function ctx(overrides: Partial<NudgeEligibilityContext> = {}): NudgeEligibilityContext {
  return {
    now: NOW,
    chargesSentToday: 0,
    dailyChargeCap: 3,
    returnModeSuppressed: false,
    itemIdsChargedToday: new Set(),
    ...overrides,
  };
}

describe('isNudgeEligible (RF-08, elegibilidade de cobrança)', () => {
  it('item vencido em status ativo é elegível', () => {
    const candidate = item({ id: 1, dueAt: '2026-08-30T10:00:00.000Z' });

    expect(isNudgeEligible(candidate, ctx())).toBe(true);
  });

  it('item com dueAt no futuro e sem ser prioridade do dia não é elegível', () => {
    const candidate = item({ id: 1, dueAt: '2026-08-31T10:00:00.000Z' });

    expect(isNudgeEligible(candidate, ctx())).toBe(false);
  });

  it('prioridade do dia não confirmada é elegível mesmo sem dueAt vencido', () => {
    const candidate = item({ id: 1, dueAt: null, isUnconfirmedTopPriority: true });

    expect(isNudgeEligible(candidate, ctx())).toBe(true);
  });

  it('item já cobrado hoje não é elegível de novo', () => {
    const candidate = item({ id: 1, dueAt: '2026-08-30T10:00:00.000Z' });

    expect(isNudgeEligible(candidate, ctx({ itemIdsChargedToday: new Set([1]) }))).toBe(false);
  });

  it('teto diário atingido bloqueia nova cobrança mesmo com item elegível', () => {
    const candidate = item({ id: 1, dueAt: '2026-08-30T10:00:00.000Z' });

    expect(isNudgeEligible(candidate, ctx({ chargesSentToday: 3, dailyChargeCap: 3 }))).toBe(false);
  });

  it('supressor do modo retorno ativo bloqueia toda elegibilidade', () => {
    const candidate = item({ id: 1, dueAt: '2026-08-30T10:00:00.000Z', isUnconfirmedTopPriority: true });

    expect(isNudgeEligible(candidate, ctx({ returnModeSuppressed: true }))).toBe(false);
  });

  it('item em status adiada vencido continua elegível', () => {
    const candidate = item({ id: 1, status: 'adiada', dueAt: '2026-08-30T10:00:00.000Z' });

    expect(isNudgeEligible(candidate, ctx())).toBe(true);
  });
});

describe('selectNudgeEligible (corte pelo teto diário)', () => {
  it('nunca seleciona mais que o restante do teto diário', () => {
    const items = [
      item({ id: 1, dueAt: '2026-08-30T10:00:00.000Z' }),
      item({ id: 2, dueAt: '2026-08-30T10:00:00.000Z' }),
      item({ id: 3, dueAt: '2026-08-30T10:00:00.000Z' }),
    ];

    const selected = selectNudgeEligible(items, ctx({ chargesSentToday: 2, dailyChargeCap: 3 }));

    expect(selected).toHaveLength(1);
  });

  it('teto já esgotado hoje devolve seleção vazia', () => {
    const items = [item({ id: 1, dueAt: '2026-08-30T10:00:00.000Z' })];

    expect(selectNudgeEligible(items, ctx({ chargesSentToday: 3, dailyChargeCap: 3 }))).toEqual([]);
  });

  it('modo retorno suprimido devolve seleção vazia mesmo com candidatos elegíveis', () => {
    const items = [item({ id: 1, dueAt: '2026-08-30T10:00:00.000Z' })];

    expect(selectNudgeEligible(items, ctx({ returnModeSuppressed: true }))).toEqual([]);
  });

  it('sem itens elegíveis devolve seleção vazia', () => {
    const items = [item({ id: 1, dueAt: '2026-08-31T10:00:00.000Z' })];

    expect(selectNudgeEligible(items, ctx())).toEqual([]);
  });
});
