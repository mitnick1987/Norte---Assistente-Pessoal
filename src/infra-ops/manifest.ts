import type { Logger } from 'pino';
import type { ModuleManifest } from '../core/kernel/types.js';
import type { JobRepository } from '../core/scheduler/index.js';
import type { MessageRepository } from '../core/channel/message-repository.js';
import type { FailureAlerter } from '../core/outbox/alerter.js';
import type { CostSettings } from './domain/cost-monitor.js';
import { runCostMonitor } from './cost-monitor-service.js';
import { checkDiskUsage } from './disk-monitor.js';
import { pingDeadMansSwitch, type DeadMansSwitchDeps } from './dead-mans-switch.js';
import { infraOpsMigrations } from './migrations/index.js';

export const DEAD_MANS_SWITCH_JOB_TYPE = 'dead_mans_switch';
export const COST_MONITOR_JOB_TYPE = 'cost_monitor';

export const DEAD_MANS_SWITCH_INTERVAL_MINUTES_SETTING = 'infraOps.deadMansSwitchIntervalMinutes';
const DEAD_MANS_SWITCH_INTERVAL_MINUTES_DEFAULT = 5;

export const SCHEDULER_STALE_AFTER_MS_SETTING = 'infraOps.schedulerStaleAfterMs';
/** Poll do scheduler é 30s (ADR-004) — 3 min de tolerância cobre jitter sem mascarar um scheduler de fato parado. */
export const SCHEDULER_STALE_AFTER_MS_DEFAULT = 180_000;

export const ALERT_ANTI_FLOOD_WINDOW_MS_SETTING = 'infraOps.alertAntiFloodWindowMs';
export const ALERT_ANTI_FLOOD_WINDOW_MS_DEFAULT = 30 * 60_000;

export const COST_MONITOR_INTERVAL_MINUTES_SETTING = 'infraOps.costMonitorIntervalMinutes';
const COST_MONITOR_INTERVAL_MINUTES_DEFAULT = 60;

export const COST_MONITOR_SAMPLE_WINDOW_DAYS_SETTING = 'infraOps.costMonitorSampleWindowDays';
const COST_MONITOR_SAMPLE_WINDOW_DAYS_DEFAULT = 1;

export const MONTHLY_BUDGET_USD_SETTING = 'infraOps.monthlyBudgetUsd';
/** ADR-007: alerta em US$25 dentro do teto de US$32/mês orçado no preço cheio do Sonnet 5. */
const MONTHLY_BUDGET_USD_DEFAULT = 25;

export const CACHE_REGRESSION_THRESHOLD_SETTING = 'infraOps.cacheRegressionThreshold';
/** N chamadas seguidas ao Sonnet com cache_read=0 — 1 isolada é esperada (conversa nova sem histórico ainda). */
const CACHE_REGRESSION_THRESHOLD_DEFAULT = 3;

export const DISK_USAGE_THRESHOLD_PERCENT_SETTING = 'infraOps.diskUsageThresholdPercent';
const DISK_USAGE_THRESHOLD_PERCENT_DEFAULT = 85;

/**
 * Preços por milhão de tokens (settings, nunca hard-coded — ADR-007 e
 * Decisões tomadas da FEAT-008): defaults abaixo refletem o preço público
 * vigente no fechamento desta feature (Sonnet 5 no preço introdutório até
 * 31/08/2026; Haiku 4.5 preço cheio) — ajustável sem deploy quando a tabela
 * da Anthropic mudar. cache_read não tem preço público tabelado por modelo;
 * o default usa a proporção usual (~10% do input) até a Anthropic publicar
 * um valor específico.
 */
export const SONNET_INPUT_PRICE_PER_MILLION_SETTING = 'infraOps.sonnetInputPricePerMillion';
const SONNET_INPUT_PRICE_PER_MILLION_DEFAULT = 3;
export const SONNET_OUTPUT_PRICE_PER_MILLION_SETTING = 'infraOps.sonnetOutputPricePerMillion';
const SONNET_OUTPUT_PRICE_PER_MILLION_DEFAULT = 15;
export const SONNET_CACHE_READ_PRICE_PER_MILLION_SETTING = 'infraOps.sonnetCacheReadPricePerMillion';
const SONNET_CACHE_READ_PRICE_PER_MILLION_DEFAULT = 0.3;

export const HAIKU_INPUT_PRICE_PER_MILLION_SETTING = 'infraOps.haikuInputPricePerMillion';
const HAIKU_INPUT_PRICE_PER_MILLION_DEFAULT = 1;
export const HAIKU_OUTPUT_PRICE_PER_MILLION_SETTING = 'infraOps.haikuOutputPricePerMillion';
const HAIKU_OUTPUT_PRICE_PER_MILLION_DEFAULT = 5;
export const HAIKU_CACHE_READ_PRICE_PER_MILLION_SETTING = 'infraOps.haikuCacheReadPricePerMillion';
const HAIKU_CACHE_READ_PRICE_PER_MILLION_DEFAULT = 0.1;

export interface BuildInfraOpsModuleDeps {
  readonly jobRepository: JobRepository;
  readonly messageRepository: MessageRepository;
  readonly alerter: FailureAlerter;
  readonly logger: Logger;
  readonly healthchecksPingUrl: string | undefined;
  readonly getHealthInput: DeadMansSwitchDeps['getHealthInput'];
  readonly getSetting: <T>(key: string) => T | undefined;
  /** Caminho do filesystem a checar (settings/env não expõe — mesmo volume do DB_PATH). */
  readonly diskCheckPath: string;
  now?: () => Date;
}

function readCostSettings(getSetting: BuildInfraOpsModuleDeps['getSetting']): CostSettings {
  return {
    sonnetPricing: {
      inputPerMillion: Number(getSetting<number>(SONNET_INPUT_PRICE_PER_MILLION_SETTING) ?? SONNET_INPUT_PRICE_PER_MILLION_DEFAULT),
      outputPerMillion: Number(getSetting<number>(SONNET_OUTPUT_PRICE_PER_MILLION_SETTING) ?? SONNET_OUTPUT_PRICE_PER_MILLION_DEFAULT),
      cacheReadPerMillion: Number(
        getSetting<number>(SONNET_CACHE_READ_PRICE_PER_MILLION_SETTING) ?? SONNET_CACHE_READ_PRICE_PER_MILLION_DEFAULT,
      ),
    },
    haikuPricing: {
      inputPerMillion: Number(getSetting<number>(HAIKU_INPUT_PRICE_PER_MILLION_SETTING) ?? HAIKU_INPUT_PRICE_PER_MILLION_DEFAULT),
      outputPerMillion: Number(getSetting<number>(HAIKU_OUTPUT_PRICE_PER_MILLION_SETTING) ?? HAIKU_OUTPUT_PRICE_PER_MILLION_DEFAULT),
      cacheReadPerMillion: Number(
        getSetting<number>(HAIKU_CACHE_READ_PRICE_PER_MILLION_SETTING) ?? HAIKU_CACHE_READ_PRICE_PER_MILLION_DEFAULT,
      ),
    },
    monthlyBudgetUsd: Number(getSetting<number>(MONTHLY_BUDGET_USD_SETTING) ?? MONTHLY_BUDGET_USD_DEFAULT),
    cacheRegressionThreshold: Number(
      getSetting<number>(CACHE_REGRESSION_THRESHOLD_SETTING) ?? CACHE_REGRESSION_THRESHOLD_DEFAULT,
    ),
  };
}

/**
 * `infra-ops` não é um módulo de domínio (ARCHITECTURE.md §2: pasta irmã de
 * `modules/`, só importa `core` — eslint-plugin-boundaries) — mas os jobs do
 * dead man's switch e do monitor de custo têm que nascer na tabela `jobs`
 * (ADR-004), e o único jeito de registrar um `JobHandler` é via
 * `ModuleManifest` no `KernelRegistry`. O manifesto aqui não é "mais um
 * módulo plugável de funcionalidade" — é o mecanismo de extensão do kernel
 * reaproveitado por infraestrutura, exatamente como a interface já permite.
 */
export function buildInfraOpsModule(deps: BuildInfraOpsModuleDeps): { manifest: ModuleManifest } {
  const manifest: ModuleManifest = {
    name: 'infra-ops',
    migrations: infraOpsMigrations,
    jobs: {
      [DEAD_MANS_SWITCH_JOB_TYPE]: async () => {
        await pingDeadMansSwitch({
          pingUrl: deps.healthchecksPingUrl,
          getHealthInput: deps.getHealthInput,
          logger: deps.logger,
          ...(deps.now ? { now: deps.now } : {}),
        });
      },
      [COST_MONITOR_JOB_TYPE]: async () => {
        await runCostMonitor({
          messageRepository: deps.messageRepository,
          alerter: deps.alerter,
          logger: deps.logger,
          getSettings: () => readCostSettings(deps.getSetting),
          sampleWindowDays: Number(
            deps.getSetting<number>(COST_MONITOR_SAMPLE_WINDOW_DAYS_SETTING) ?? COST_MONITOR_SAMPLE_WINDOW_DAYS_DEFAULT,
          ),
          ...(deps.now ? { now: deps.now } : {}),
        });
        await checkDiskUsage({
          path: deps.diskCheckPath,
          thresholdPercent: Number(
            deps.getSetting<number>(DISK_USAGE_THRESHOLD_PERCENT_SETTING) ?? DISK_USAGE_THRESHOLD_PERCENT_DEFAULT,
          ),
          alerter: deps.alerter,
          logger: deps.logger,
        });
      },
    },
    settingsDefaults: {
      [DEAD_MANS_SWITCH_INTERVAL_MINUTES_SETTING]: DEAD_MANS_SWITCH_INTERVAL_MINUTES_DEFAULT,
      [SCHEDULER_STALE_AFTER_MS_SETTING]: SCHEDULER_STALE_AFTER_MS_DEFAULT,
      [ALERT_ANTI_FLOOD_WINDOW_MS_SETTING]: ALERT_ANTI_FLOOD_WINDOW_MS_DEFAULT,
      [COST_MONITOR_INTERVAL_MINUTES_SETTING]: COST_MONITOR_INTERVAL_MINUTES_DEFAULT,
      [COST_MONITOR_SAMPLE_WINDOW_DAYS_SETTING]: COST_MONITOR_SAMPLE_WINDOW_DAYS_DEFAULT,
      [MONTHLY_BUDGET_USD_SETTING]: MONTHLY_BUDGET_USD_DEFAULT,
      [CACHE_REGRESSION_THRESHOLD_SETTING]: CACHE_REGRESSION_THRESHOLD_DEFAULT,
      [DISK_USAGE_THRESHOLD_PERCENT_SETTING]: DISK_USAGE_THRESHOLD_PERCENT_DEFAULT,
      [SONNET_INPUT_PRICE_PER_MILLION_SETTING]: SONNET_INPUT_PRICE_PER_MILLION_DEFAULT,
      [SONNET_OUTPUT_PRICE_PER_MILLION_SETTING]: SONNET_OUTPUT_PRICE_PER_MILLION_DEFAULT,
      [SONNET_CACHE_READ_PRICE_PER_MILLION_SETTING]: SONNET_CACHE_READ_PRICE_PER_MILLION_DEFAULT,
      [HAIKU_INPUT_PRICE_PER_MILLION_SETTING]: HAIKU_INPUT_PRICE_PER_MILLION_DEFAULT,
      [HAIKU_OUTPUT_PRICE_PER_MILLION_SETTING]: HAIKU_OUTPUT_PRICE_PER_MILLION_DEFAULT,
      [HAIKU_CACHE_READ_PRICE_PER_MILLION_SETTING]: HAIKU_CACHE_READ_PRICE_PER_MILLION_DEFAULT,
    },
  };

  return { manifest };
}
