import type { Logger } from 'pino';
import type { FailureAlerter } from '../core/outbox/alerter.js';
import type { MessageRepository } from '../core/channel/message-repository.js';
import { toZonedParts } from '../core/scheduler/domain/timezone.js';
import {
  budgetExceeded,
  detectCacheRegression,
  projectMonthlyCost,
  summarizeCost,
  type CostSettings,
  type UsageRow,
} from './domain/cost-monitor.js';

export interface CostMonitorDeps {
  readonly messageRepository: MessageRepository;
  readonly alerter: FailureAlerter;
  readonly logger: Logger;
  readonly getSettings: () => CostSettings;
  /** Janela da amostra usada para projetar o mês (settings) — não precisa ser o mês inteiro corrido, só uma amostra recente representativa. */
  readonly sampleWindowDays: number;
  now?: () => Date;
}

function daysInMonth(date: Date): number {
  const { year, month } = toZonedParts(date);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Resumo de custo (spec item 5): calcula projeção mensal a partir de
 * `messages`, loga o resumo estruturado, e aciona os dois alertas de
 * negócio — orçamento estourado e regressão de cache (esta com prioridade
 * mais alta, avaliada primeiro e sem relação com o valor do orçamento).
 */
export async function runCostMonitor(deps: CostMonitorDeps): Promise<void> {
  const now = deps.now ? deps.now() : new Date();
  const settings = deps.getSettings();

  const since = new Date(now.getTime() - deps.sampleWindowDays * 24 * 60 * 60 * 1000);
  const rows: UsageRow[] = deps.messageRepository.findUsageSince(since).map((row) => ({
    intent: row.intent,
    tokensIn: row.tokensIn,
    tokensOut: row.tokensOut,
    cacheReadTokens: row.cacheReadTokens,
    createdAt: new Date(row.createdAt),
  }));

  const summary = summarizeCost(rows, settings);
  const projectedMonthlyCostUsd = projectMonthlyCost(summary.totalCostUsd, deps.sampleWindowDays, daysInMonth(now));

  deps.logger.info(
    {
      sampleDays: deps.sampleWindowDays,
      sampleCostUsd: summary.totalCostUsd,
      projectedMonthlyCostUsd,
      sonnetTokens: summary.sonnetTokens,
      haikuTokens: summary.haikuTokens,
      cacheHitRate: summary.cacheHitRate,
    },
    'resumo de custo de API',
  );

  if (detectCacheRegression(rows, settings)) {
    await deps.alerter.alertCacheRegression();
  }

  if (budgetExceeded(projectedMonthlyCostUsd, settings)) {
    await deps.alerter.alertCostBudgetExceeded({ projectedMonthlyCostUsd, budgetUsd: settings.monthlyBudgetUsd });
  }
}
