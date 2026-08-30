import type { Database } from 'better-sqlite3';
import type { Logger } from 'pino';
import type { ModuleManifest } from '../../core/kernel/types.js';
import type { OutboxRepository } from '../../core/outbox/index.js';
import type { ItemService } from '../tasks/public/index.js';
import type { ReturnModeService } from '../return-mode/public/index.js';
import { ChargesRepository } from './charges-repository.js';
import { PatternsRepository } from './patterns-repository.js';
import { NudgeService } from './nudge-service.js';
import { buildNudgesCommands } from './commands.js';
import { nudgesMigrations } from './migrations/index.js';

export const NUDGES_DAILY_CHARGE_CAP_SETTING = 'nudges.dailyChargeCap';
const NUDGES_DAILY_CHARGE_CAP_DEFAULT = 3;

export const NUDGES_FALLBACK_SNOOZE_HOUR_SETTING = 'nudges.fallbackSnoozeHour';
const NUDGES_FALLBACK_SNOOZE_HOUR_DEFAULT = 9;

export const NUDGES_FALLBACK_SNOOZE_MINUTE_SETTING = 'nudges.fallbackSnoozeMinute';
const NUDGES_FALLBACK_SNOOZE_MINUTE_DEFAULT = 0;

/** Cadência da checagem de elegibilidade (spec item 1: "job durável verifica elegibilidade") — separada do teto de quantas cobranças saem por dia. */
export const NUDGES_CHECK_INTERVAL_MINUTES_SETTING = 'nudges.checkIntervalMinutes';
const NUDGES_CHECK_INTERVAL_MINUTES_DEFAULT = 60;

export const COBRANCA_JOB_TYPE = 'cobranca';

export interface BuildNudgesModuleDeps {
  readonly db: Database;
  readonly itemService: ItemService;
  readonly outboxRepository: OutboxRepository;
  readonly returnModeService: ReturnModeService;
  readonly ownerJid: string;
  readonly logger: Logger;
  readonly getDailyChargeCap: () => number;
  readonly getFallbackSnoozeHour: () => number;
  readonly getFallbackSnoozeMinute: () => number;
  now?: () => Date;
}

/**
 * `nudges` (RF-08, spec FEAT-007): fechamento de loop via job durável
 * `cobranca` (ADR-004) + comandos determinísticos "1"/"2"/"3" — nenhuma
 * chamada de LLM neste módulo (mesma régua de tom mais conservadora da
 * spec). Migração própria (`patterns` mínima + `nudges_charges`).
 */
export function buildNudgesModule(deps: BuildNudgesModuleDeps): { manifest: ModuleManifest; service: NudgeService } {
  const chargesRepository = new ChargesRepository(deps.db);
  const patternsRepository = new PatternsRepository(deps.db);

  const service = new NudgeService({
    itemService: deps.itemService,
    chargesRepository,
    patternsRepository,
    outboxRepository: deps.outboxRepository,
    returnModeService: deps.returnModeService,
    ownerJid: deps.ownerJid,
    logger: deps.logger,
    getDailyChargeCap: deps.getDailyChargeCap,
    getFallbackSnoozeHour: deps.getFallbackSnoozeHour,
    getFallbackSnoozeMinute: deps.getFallbackSnoozeMinute,
    ...(deps.now ? { now: deps.now } : {}),
  });

  const manifest: ModuleManifest = {
    name: 'nudges',
    migrations: nudgesMigrations,
    commands: buildNudgesCommands(deps.itemService, service),
    jobs: {
      [COBRANCA_JOB_TYPE]: async () => {
        await service.checkAndSendDue();
      },
    },
    settingsDefaults: {
      [NUDGES_DAILY_CHARGE_CAP_SETTING]: NUDGES_DAILY_CHARGE_CAP_DEFAULT,
      [NUDGES_FALLBACK_SNOOZE_HOUR_SETTING]: NUDGES_FALLBACK_SNOOZE_HOUR_DEFAULT,
      [NUDGES_FALLBACK_SNOOZE_MINUTE_SETTING]: NUDGES_FALLBACK_SNOOZE_MINUTE_DEFAULT,
      [NUDGES_CHECK_INTERVAL_MINUTES_SETTING]: NUDGES_CHECK_INTERVAL_MINUTES_DEFAULT,
    },
  };

  return { manifest, service };
}
