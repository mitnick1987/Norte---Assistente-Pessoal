import { describe, expect, it } from 'vitest';
import { buildRescheduleMessage, buildRescheduleProposal } from '../../src/modules/nudges/domain/index.js';

// domingo 2026-08-30 12:00 America/Sao_Paulo (15:00 UTC)
const NOW = new Date('2026-08-30T15:00:00.000Z');
const FALLBACK = { hour: 9, minute: 0 };

describe('buildRescheduleProposal (RF-08, spec item 1)', () => {
  it('com padrão em patterns, propõe o horário mais frequente (nunca pergunta "para quando?")', () => {
    const samples = [
      { weekday: 6, hour: 9 }, // sábado 9h
      { weekday: 6, hour: 9 },
    ];

    const proposal = buildRescheduleProposal(samples, FALLBACK, NOW);

    expect(proposal.source).toBe('pattern');
    expect(proposal.label).toContain('sábado');
    expect(proposal.proposedAt).not.toBeNull();
  });

  it('proposta a partir de padrão é sempre estritamente futura em relação a agora', () => {
    const samples = [{ weekday: 0, hour: 10 }]; // domingo 10h — hoje é domingo 12h local, já passou

    const proposal = buildRescheduleProposal(samples, FALLBACK, NOW);

    expect(new Date(proposal.proposedAt).getTime()).toBeGreaterThan(NOW.getTime());
  });

  it('sem padrão em patterns, cai no fallback de settings (amanhã no horário configurado)', () => {
    const proposal = buildRescheduleProposal([], FALLBACK, NOW);

    expect(proposal.source).toBe('fallback');
    expect(proposal.label).toContain('amanhã');
  });

  it('fallback nunca é a pergunta "para quando?"', () => {
    const proposal = buildRescheduleProposal([], FALLBACK, NOW);

    expect(proposal.label.toLowerCase()).not.toContain('para quando');
  });

  it('mesmos dados de entrada produzem a mesma proposta (determinístico)', () => {
    const samples = [{ weekday: 6, hour: 9 }];

    const first = buildRescheduleProposal(samples, FALLBACK, NOW);
    const second = buildRescheduleProposal(samples, FALLBACK, NOW);

    expect(first).toEqual(second);
  });

  it('cruzando virada de mês, fallback "amanhã" resolve corretamente', () => {
    const lastDayOfMonth = new Date('2026-08-31T23:30:00.000Z'); // 31/08 20h30 SP

    const proposal = buildRescheduleProposal([], FALLBACK, lastDayOfMonth);

    const proposedDate = new Date(proposal.proposedAt);
    expect(proposedDate.getUTCMonth()).toBe(8); // setembro (0-indexed)
  });
});

describe('buildRescheduleMessage (100% determinística, nunca pergunta "para quando?")', () => {
  it('propõe o horário concreto seguido de confirmação simples', () => {
    const proposal = buildRescheduleProposal([{ weekday: 6, hour: 9 }], FALLBACK, NOW);

    const message = buildRescheduleMessage(proposal);

    expect(message.toLowerCase()).not.toContain('para quando');
    expect(message).toContain('topa');
  });
});
