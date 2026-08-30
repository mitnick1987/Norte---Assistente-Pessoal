/**
 * Contrato público de `rituals` (ARCHITECTURE.md §2): usado só por `app.ts`
 * para compor o módulo — nenhum outro módulo depende de `rituals` (é o
 * último elo da cadeia: consome `tasks`/`google-calendar`, ninguém consome
 * ele de volta).
 */
export {
  buildRitualsModule,
  seedRitualJobs,
  BRIEFING_HOUR_SETTING,
  BRIEFING_MINUTE_SETTING,
  REVISAO_HOUR_SETTING,
  REVISAO_MINUTE_SETTING,
} from '../manifest.js';
export type { BuildRitualsModuleDeps } from '../manifest.js';
export { BriefingService } from '../briefing-service.js';
export type { RemoteAgendaPort } from '../briefing-service.js';
export { ReviewService } from '../review-service.js';
export { BRIEFING_JOB_TYPE, REVISAO_JOB_TYPE } from '../job-scheduling.js';
