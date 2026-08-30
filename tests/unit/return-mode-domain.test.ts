import { describe, expect, it } from 'vitest';
import { buildReentrySummaryMessage, isReturnModeActive } from '../../src/modules/return-mode/domain/index.js';
import { assertToneIsSafe } from '../tone/forbidden-patterns.js';

const NOW = new Date('2026-08-30T12:00:00.000Z');

describe('isReturnModeActive (RF-10, limiar de 48h)', () => {
  it('silêncio < 48h não ativa o modo', () => {
    const lastInbound = new Date(NOW.getTime() - 47 * 60 * 60 * 1000);

    expect(isReturnModeActive(lastInbound, NOW)).toBe(false);
  });

  it('silêncio >= 48h ativa o modo', () => {
    const lastInbound = new Date(NOW.getTime() - 48 * 60 * 60 * 1000);

    expect(isReturnModeActive(lastInbound, NOW)).toBe(true);
  });

  it('silêncio bem além de 48h também ativa', () => {
    const lastInbound = new Date(NOW.getTime() - 5 * 24 * 60 * 60 * 1000);

    expect(isReturnModeActive(lastInbound, NOW)).toBe(true);
  });

  it('sem nenhuma mensagem de entrada anterior, nunca ativa (não há "silêncio" antes do primeiro contato)', () => {
    expect(isReturnModeActive(undefined, NOW)).toBe(false);
  });
});

describe('buildReentrySummaryMessage (RF-10, resumo de reentrada)', () => {
  it('nunca pede "colocar em dia"', () => {
    const message = buildReentrySummaryMessage({ silentDays: 3, pendingCount: 5 });

    expect(message.toLowerCase()).not.toContain('colocar em dia');
  });

  it('nunca lista os itens parados individualmente — só a contagem agregada', () => {
    const message = buildReentrySummaryMessage({ silentDays: 3, pendingCount: 5 });

    expect(message).toContain('5');
    expect(message).not.toContain(' - '); // nenhum formato de lista com marcadores
  });

  it('sem nenhuma decisão pedida — mensagem não termina em pergunta de escolha', () => {
    const message = buildReentrySummaryMessage({ silentDays: 3, pendingCount: 5 });

    expect(message).not.toMatch(/1\).*2\).*3\)/s);
  });

  it('sem itens pendentes, reconhece isso de forma honesta', () => {
    const message = buildReentrySummaryMessage({ silentDays: 2, pendingCount: 0 });

    expect(message.toLowerCase()).toMatch(/nada parado|lista está tranquila/);
  });

  it('passa no filtro de tom RSD-safe compartilhado', () => {
    assertToneIsSafe(buildReentrySummaryMessage({ silentDays: 2, pendingCount: 3 }));
    assertToneIsSafe(buildReentrySummaryMessage({ silentDays: 10, pendingCount: 0 }));
  });
});
