import { describe, expect, it } from 'vitest';
import {
  buildHygieneMessage,
  buildHygieneProposal,
  isHygieneEligible,
  selectHygieneCandidate,
  type HygieneCandidateItem,
} from '../../src/modules/hygiene/domain/index.js';

const NOW = new Date('2026-08-30T12:00:00.000Z');

function item(overrides: Partial<HygieneCandidateItem> & { id: number }): HygieneCandidateItem {
  return {
    title: `item ${overrides.id}`,
    snoozeCount: 0,
    updatedAt: '2026-08-30T10:00:00.000Z',
    ...overrides,
  };
}

describe('isHygieneEligible (RF-11)', () => {
  it('item com snoozeCount >= 3 é elegível', () => {
    const candidate = item({ id: 1, snoozeCount: 3, updatedAt: '2026-08-30T10:00:00.000Z' });

    expect(isHygieneEligible(candidate, NOW)).toBe(true);
  });

  it('item parado >= 21 dias sem esse número de adiamentos também é elegível', () => {
    const staleDate = new Date(NOW.getTime() - 21 * 24 * 60 * 60 * 1000).toISOString();
    const candidate = item({ id: 1, snoozeCount: 0, updatedAt: staleDate });

    expect(isHygieneEligible(candidate, NOW)).toBe(true);
  });

  it('item recém-modificado com poucos adiamentos não é elegível', () => {
    const candidate = item({ id: 1, snoozeCount: 1, updatedAt: '2026-08-30T11:00:00.000Z' });

    expect(isHygieneEligible(candidate, NOW)).toBe(false);
  });

  it('item parado 20 dias (abaixo do limiar) não é elegível', () => {
    const almostStale = new Date(NOW.getTime() - 20 * 24 * 60 * 60 * 1000).toISOString();
    const candidate = item({ id: 1, snoozeCount: 0, updatedAt: almostStale });

    expect(isHygieneEligible(candidate, NOW)).toBe(false);
  });

  it('payload de saída (HygieneProposal) nunca inclui snoozeCount', () => {
    const candidate = item({ id: 1, snoozeCount: 5 });
    const proposal = buildHygieneProposal(candidate, NOW);

    expect(JSON.stringify(proposal)).not.toMatch(/snooze/i);
  });
});

describe('selectHygieneCandidate (nunca mais de uma proposta por revisão)', () => {
  it('escolhe o item mais antigo (menor id) entre os elegíveis', () => {
    const items = [item({ id: 8, snoozeCount: 3 }), item({ id: 2, snoozeCount: 3 }), item({ id: 5, snoozeCount: 3 })];

    expect(selectHygieneCandidate(items, NOW)?.id).toBe(2);
  });

  it('sem itens elegíveis, nenhum candidato', () => {
    const items = [item({ id: 1, snoozeCount: 0 })];

    expect(selectHygieneCandidate(items, NOW)).toBeUndefined();
  });
});

describe('buildHygieneMessage (RF-14: nunca soa como fracasso)', () => {
  it('sempre oferece as 3 opções: arquivar, dropar, adiar', () => {
    const proposal = buildHygieneProposal(item({ id: 1, snoozeCount: 3 }), NOW);
    const message = buildHygieneMessage(proposal, proposal.itemId);

    expect(message).toContain('arquivar');
    expect(message).toContain('dropar');
    expect(message).toContain('adiar');
  });

  it('nunca sugere "quebrar essa tarefa" (fora de escopo, RF-17/18)', () => {
    const proposal = buildHygieneProposal(item({ id: 1, snoozeCount: 3 }), NOW);
    const message = buildHygieneMessage(proposal, proposal.itemId);

    expect(message.toLowerCase()).not.toContain('quebrar');
  });

  it('nunca cita quantas vezes o item foi adiado', () => {
    const proposal = buildHygieneProposal(item({ id: 1, snoozeCount: 7 }), NOW);
    const message = buildHygieneMessage(proposal, proposal.itemId);

    expect(message).not.toMatch(/\d+\s*(ª|a)\s*vez/i);
    expect(message).not.toMatch(/7/);
  });

  it('data de "adiar pro mês que vem" é concreta, nunca pergunta "para quando?"', () => {
    const proposal = buildHygieneProposal(item({ id: 1, snoozeCount: 3 }), NOW);

    expect(proposal.nextMonthDueAt).toBeDefined();
    const message = buildHygieneMessage(proposal, proposal.itemId);
    expect(message.toLowerCase()).not.toContain('para quando');
  });

  it('dia 31 vira o último dia de setembro (30) — nunca transborda pro mês seguinte', () => {
    const lastDayOfAugust = new Date('2026-08-31T14:00:00.000Z'); // 31/08 11h SP
    const candidate = item({ id: 1, snoozeCount: 3 });

    const proposal = buildHygieneProposal(candidate, lastDayOfAugust);

    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(proposal.nextMonthDueAt));
    const byType = Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
    expect(byType['month']).toBe('09');
    expect(byType['day']).toBe('30');
  });

  it('dia 31 de janeiro vira o último dia de fevereiro (28, ano não bissexto) — clamping de calendário', () => {
    const lastDayOfJanuary = new Date('2026-01-31T14:00:00.000Z'); // 31/01 11h SP, 2026 não é bissexto
    const candidate = item({ id: 1, snoozeCount: 3 });

    const proposal = buildHygieneProposal(candidate, lastDayOfJanuary);

    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(proposal.nextMonthDueAt));
    const byType = Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
    expect(byType['month']).toBe('02');
    expect(byType['day']).toBe('28');
  });

  it('virada de ano: dezembro + 1 mês vira janeiro do ano seguinte', () => {
    const midDecember = new Date('2026-12-15T14:00:00.000Z'); // 15/12 11h SP
    const candidate = item({ id: 1, snoozeCount: 3 });

    const proposal = buildHygieneProposal(candidate, midDecember);

    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(proposal.nextMonthDueAt));
    const byType = Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
    expect(byType['year']).toBe('2027');
    expect(byType['month']).toBe('01');
  });
});
