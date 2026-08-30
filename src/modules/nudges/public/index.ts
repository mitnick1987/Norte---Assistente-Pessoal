/**
 * Contrato público de `nudges` (ARCHITECTURE.md §2): usado só por `app.ts`
 * para compor o módulo e semear o job `cobranca` no boot — nenhum outro
 * módulo depende de `nudges`.
 */
export {
  buildNudgesModule,
  COBRANCA_JOB_TYPE,
  NUDGES_DAILY_CHARGE_CAP_SETTING,
  NUDGES_FALLBACK_SNOOZE_HOUR_SETTING,
  NUDGES_FALLBACK_SNOOZE_MINUTE_SETTING,
  NUDGES_CHECK_INTERVAL_MINUTES_SETTING,
} from '../manifest.js';
export type { BuildNudgesModuleDeps } from '../manifest.js';
export { ensureNudgesJob } from '../job-scheduling.js';
export { NudgeService } from '../nudge-service.js';
