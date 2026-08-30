/**
 * Preço por milhão de tokens (settings, nunca hard-coded — Decisões tomadas
 * da spec: ADR-007 deliberadamente não crava valor de tabela de preço em
 * código, porque muda por decisão da Anthropic, não do produto).
 */
export interface ModelPricing {
  readonly inputPerMillion: number;
  readonly outputPerMillion: number;
  readonly cacheReadPerMillion: number;
}

export interface CostSettings {
  readonly sonnetPricing: ModelPricing;
  readonly haikuPricing: ModelPricing;
  readonly monthlyBudgetUsd: number;
  /** N ocorrências consecutivas de `cacheReadTokens = 0` ao Sonnet que caracterizam regressão de cache (settings). */
  readonly cacheRegressionThreshold: number;
}

/** `triagem` é a única chamada roteada para Haiku (capture/manifest.ts); todo o resto (`conversa`, `briefing`, `revisao`) vai para Sonnet. */
const HAIKU_INTENT = 'triagem';

export interface UsageRow {
  readonly intent: string;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly cacheReadTokens: number;
  readonly createdAt: Date;
}

function modelForIntent(intent: string): 'sonnet' | 'haiku' {
  return intent === HAIKU_INTENT ? 'haiku' : 'sonnet';
}

function costOf(tokensIn: number, tokensOut: number, cacheReadTokens: number, pricing: ModelPricing): number {
  // cache_read substitui parte do tokensIn full-price (Anthropic cobra o
  // cache hit à parte, mais barato) — tokensIn aqui já vem líquido de cache
  // (é o dado gravado pelo provider, ver core/llm/provider.ts LlmUsage).
  const inputCost = (tokensIn / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (tokensOut / 1_000_000) * pricing.outputPerMillion;
  const cacheCost = (cacheReadTokens / 1_000_000) * pricing.cacheReadPerMillion;
  return inputCost + outputCost + cacheCost;
}

export interface CostSummary {
  readonly totalCostUsd: number;
  readonly sonnetTokens: { readonly in: number; readonly out: number; readonly cacheRead: number };
  readonly haikuTokens: { readonly in: number; readonly out: number; readonly cacheRead: number };
  readonly cacheHitRate: number;
}

/** Resumo de custo (spec item 5) — tokens por modelo + taxa de cache hit, para o log estruturado periódico. */
export function summarizeCost(rows: readonly UsageRow[], settings: CostSettings): CostSummary {
  let totalCostUsd = 0;
  const sonnetTokens = { in: 0, out: 0, cacheRead: 0 };
  const haikuTokens = { in: 0, out: 0, cacheRead: 0 };

  for (const row of rows) {
    const model = modelForIntent(row.intent);
    const pricing = model === 'sonnet' ? settings.sonnetPricing : settings.haikuPricing;
    totalCostUsd += costOf(row.tokensIn, row.tokensOut, row.cacheReadTokens, pricing);

    const bucket = model === 'sonnet' ? sonnetTokens : haikuTokens;
    bucket.in += row.tokensIn;
    bucket.out += row.tokensOut;
    bucket.cacheRead += row.cacheReadTokens;
  }

  const totalInputEligibleForCache = sonnetTokens.in + sonnetTokens.cacheRead + haikuTokens.in + haikuTokens.cacheRead;
  const totalCacheRead = sonnetTokens.cacheRead + haikuTokens.cacheRead;
  const cacheHitRate = totalInputEligibleForCache > 0 ? totalCacheRead / totalInputEligibleForCache : 0;

  return { totalCostUsd, sonnetTokens, haikuTokens, cacheHitRate };
}

/**
 * Projeção mensal a partir de uma amostra: extrapola linear pelo período
 * coberto pela amostra (dias corridos) até os dias do mês corrente — simples
 * e auditável, sem sazonalidade (não é o objetivo do alerta, é detectar
 * disparo grosseiro de custo, não prever com precisão de BI).
 */
export function projectMonthlyCost(sampleCostUsd: number, sampleDays: number, daysInMonth: number): number {
  if (sampleDays <= 0) return 0;
  return (sampleCostUsd / sampleDays) * daysInMonth;
}

export function budgetExceeded(projectedMonthlyCostUsd: number, settings: CostSettings): boolean {
  return projectedMonthlyCostUsd > settings.monthlyBudgetUsd;
}

/**
 * Alarme de regressão de cache (ADR-007, spec item 5): `cache_read = 0` em
 * N chamadas SEGUIDAS ao Sonnet — uma única ocorrência isolada é esperada
 * (primeira chamada de uma conversa nova, sem histórico ainda) e não deveria
 * disparar nada; só a sequência sugere que o prompt parou de bater cache.
 * `rows` é assumido em ordem cronológica (mais antiga primeiro).
 */
export function detectCacheRegression(rows: readonly UsageRow[], settings: CostSettings): boolean {
  let consecutiveZeroCacheSonnet = 0;

  for (const row of rows) {
    if (modelForIntent(row.intent) !== 'sonnet') continue;

    if (row.cacheReadTokens === 0) {
      consecutiveZeroCacheSonnet += 1;
      if (consecutiveZeroCacheSonnet >= settings.cacheRegressionThreshold) return true;
    } else {
      consecutiveZeroCacheSonnet = 0;
    }
  }

  return false;
}
