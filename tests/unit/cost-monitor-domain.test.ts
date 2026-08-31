import { describe, expect, it } from 'vitest';
import {
  summarizeCost,
  projectMonthlyCost,
  budgetExceeded,
  detectCacheRegression,
  type CostSettings,
  type UsageRow,
} from '../../src/infra-ops/domain/cost-monitor.js';

const SETTINGS: CostSettings = {
  sonnetPricing: { inputPerMillion: 3, outputPerMillion: 15, cacheReadPerMillion: 0.3 },
  haikuPricing: { inputPerMillion: 1, outputPerMillion: 5, cacheReadPerMillion: 0.1 },
  monthlyBudgetUsd: 25,
  cacheRegressionThreshold: 3,
  cacheRegressionMaxGapMs: 5 * 60_000,
};

function usageRow(overrides: Partial<UsageRow> = {}): UsageRow {
  return {
    intent: 'conversa',
    tokensIn: 1_000_000,
    tokensOut: 1_000_000,
    cacheReadTokens: 0,
    createdAt: new Date('2026-08-30T12:00:00.000Z'),
    ...overrides,
  };
}

describe('summarizeCost', () => {
  it('calcula custo de uma chamada ao Sonnet (intent != triagem) pelo preço do Sonnet', () => {
    const summary = summarizeCost([usageRow({ intent: 'conversa' })], SETTINGS);

    // 1M tokens de input a $3/M + 1M de output a $15/M = $18
    expect(summary.totalCostUsd).toBeCloseTo(18, 6);
    expect(summary.sonnetTokens).toEqual({ in: 1_000_000, out: 1_000_000, cacheRead: 0 });
    expect(summary.haikuTokens).toEqual({ in: 0, out: 0, cacheRead: 0 });
  });

  it('calcula custo de uma chamada de triagem pelo preço do Haiku', () => {
    const summary = summarizeCost([usageRow({ intent: 'triagem' })], SETTINGS);

    // 1M input a $1/M + 1M output a $5/M = $6
    expect(summary.totalCostUsd).toBeCloseTo(6, 6);
    expect(summary.haikuTokens).toEqual({ in: 1_000_000, out: 1_000_000, cacheRead: 0 });
  });

  it('inclui cache_read no custo, ao preço específico de cache do modelo', () => {
    const summary = summarizeCost(
      [usageRow({ intent: 'conversa', tokensIn: 0, tokensOut: 0, cacheReadTokens: 1_000_000 })],
      SETTINGS,
    );

    expect(summary.totalCostUsd).toBeCloseTo(0.3, 6);
  });

  it('calcula taxa de cache hit como proporção de cache_read sobre o total elegível', () => {
    const summary = summarizeCost(
      [usageRow({ intent: 'conversa', tokensIn: 500_000, tokensOut: 0, cacheReadTokens: 500_000 })],
      SETTINGS,
    );

    expect(summary.cacheHitRate).toBeCloseTo(0.5, 6);
  });

  it('lista vazia produz custo zero e cache hit rate zero (sem divisão por zero)', () => {
    const summary = summarizeCost([], SETTINGS);

    expect(summary.totalCostUsd).toBe(0);
    expect(summary.cacheHitRate).toBe(0);
  });
});

describe('projectMonthlyCost', () => {
  it('extrapola linearmente o custo da amostra para os dias do mês', () => {
    // US$1 em 1 dia de amostra, projetado para um mês de 30 dias = US$30
    expect(projectMonthlyCost(1, 1, 30)).toBeCloseTo(30, 6);
  });

  it('amostra de vários dias divide antes de projetar', () => {
    // US$10 em 5 dias = US$2/dia, projetado para 30 dias = US$60
    expect(projectMonthlyCost(10, 5, 30)).toBeCloseTo(60, 6);
  });

  it('sampleDays zero ou negativo não gera divisão por zero/infinito', () => {
    expect(projectMonthlyCost(10, 0, 30)).toBe(0);
  });
});

describe('budgetExceeded', () => {
  it('true quando a projeção passa do orçamento', () => {
    expect(budgetExceeded(30, SETTINGS)).toBe(true);
  });

  it('false quando a projeção está dentro do orçamento', () => {
    expect(budgetExceeded(20, SETTINGS)).toBe(false);
  });

  it('false quando a projeção é exatamente o orçamento (limite não é excedido no igual)', () => {
    expect(budgetExceeded(25, SETTINGS)).toBe(false);
  });
});

describe('detectCacheRegression', () => {
  it('dispara com N ocorrências CONSECUTIVAS de cache_read=0 ao Sonnet (N = threshold)', () => {
    const rows = [
      usageRow({ intent: 'conversa', cacheReadTokens: 0 }),
      usageRow({ intent: 'conversa', cacheReadTokens: 0 }),
      usageRow({ intent: 'conversa', cacheReadTokens: 0 }),
    ];

    expect(detectCacheRegression(rows, SETTINGS)).toBe(true);
  });

  it('uma única ocorrência isolada não dispara (evita falso positivo de request legítimo sem histórico)', () => {
    const rows = [
      usageRow({ intent: 'conversa', cacheReadTokens: 500 }),
      usageRow({ intent: 'conversa', cacheReadTokens: 0 }),
      usageRow({ intent: 'conversa', cacheReadTokens: 500 }),
    ];

    expect(detectCacheRegression(rows, SETTINGS)).toBe(false);
  });

  it('cache hit no meio da sequência reseta a contagem consecutiva', () => {
    const rows = [
      usageRow({ intent: 'conversa', cacheReadTokens: 0 }),
      usageRow({ intent: 'conversa', cacheReadTokens: 0 }),
      usageRow({ intent: 'conversa', cacheReadTokens: 500 }),
      usageRow({ intent: 'conversa', cacheReadTokens: 0 }),
      usageRow({ intent: 'conversa', cacheReadTokens: 0 }),
    ];

    expect(detectCacheRegression(rows, SETTINGS)).toBe(false);
  });

  it('chamadas de triagem (Haiku) com cache_read=0 nunca contam para o alarme — é sinal específico do Sonnet', () => {
    const rows = [
      usageRow({ intent: 'triagem', cacheReadTokens: 0 }),
      usageRow({ intent: 'triagem', cacheReadTokens: 0 }),
      usageRow({ intent: 'triagem', cacheReadTokens: 0 }),
      usageRow({ intent: 'triagem', cacheReadTokens: 0 }),
    ];

    expect(detectCacheRegression(rows, SETTINGS)).toBe(false);
  });

  it('chamadas de triagem intercaladas não quebram a contagem consecutiva do Sonnet', () => {
    const rows = [
      usageRow({ intent: 'conversa', cacheReadTokens: 0 }),
      usageRow({ intent: 'triagem', cacheReadTokens: 0 }),
      usageRow({ intent: 'conversa', cacheReadTokens: 0 }),
      usageRow({ intent: 'conversa', cacheReadTokens: 0 }),
    ];

    expect(detectCacheRegression(rows, SETTINGS)).toBe(true);
  });

  it('nenhum alarme em uso normal de cache (todas as chamadas com cache hit)', () => {
    const rows = [
      usageRow({ intent: 'conversa', cacheReadTokens: 500 }),
      usageRow({ intent: 'conversa', cacheReadTokens: 500 }),
      usageRow({ intent: 'conversa', cacheReadTokens: 500 }),
    ];

    expect(detectCacheRegression(rows, SETTINGS)).toBe(false);
  });

  it('briefing e revisão intercalados com ~14h de gap não disparam (cache frio esperado, gap muito além do TTL)', () => {
    const day1briefing = new Date('2026-08-30T10:40:00.000Z'); // 7h40 America/Sao_Paulo
    const day1revisao = new Date('2026-08-31T00:30:00.000Z'); // 21h30 America/Sao_Paulo
    const day2briefing = new Date('2026-08-31T10:40:00.000Z');
    const rows = [
      usageRow({ intent: 'briefing', cacheReadTokens: 0, createdAt: day1briefing }),
      usageRow({ intent: 'revisao', cacheReadTokens: 0, createdAt: day1revisao }),
      usageRow({ intent: 'briefing', cacheReadTokens: 0, createdAt: day2briefing }),
    ];

    expect(detectCacheRegression(rows, SETTINGS)).toBe(false);
  });

  it('conversa consecutiva com gap curto (dentro do TTL do cache) soma para a contagem e dispara', () => {
    const start = new Date('2026-08-30T12:00:00.000Z');
    const rows = [
      usageRow({ intent: 'conversa', cacheReadTokens: 0, createdAt: start }),
      usageRow({ intent: 'conversa', cacheReadTokens: 0, createdAt: new Date(start.getTime() + 60_000) }),
      usageRow({ intent: 'conversa', cacheReadTokens: 0, createdAt: new Date(start.getTime() + 120_000) }),
    ];

    expect(detectCacheRegression(rows, SETTINGS)).toBe(true);
  });

  it('gap além do TTL entre chamadas de conversa reinicia a contagem consecutiva mesmo sem trocar de intent', () => {
    const start = new Date('2026-08-30T12:00:00.000Z');
    const rows = [
      usageRow({ intent: 'conversa', cacheReadTokens: 0, createdAt: start }),
      usageRow({ intent: 'conversa', cacheReadTokens: 0, createdAt: new Date(start.getTime() + 60_000) }),
      // gap de 1h > TTL de 5min: reinicia a sequência
      usageRow({ intent: 'conversa', cacheReadTokens: 0, createdAt: new Date(start.getTime() + 60 * 60_000) }),
    ];

    expect(detectCacheRegression(rows, SETTINGS)).toBe(false);
  });
});
