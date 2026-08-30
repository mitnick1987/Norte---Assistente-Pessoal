import type { Logger } from 'pino';
import type { ModuleManifest } from '../../core/kernel/types.js';
import type { LlmProvider, LlmUsage, PromptFragmentSource } from '../../core/llm/index.js';
import { buildBrainSystemPrompt } from '../../core/llm/index.js';
import type { JobRepository } from '../../core/scheduler/index.js';
import type { OutboxRepository } from '../../core/outbox/index.js';
import type { ItemService } from '../tasks/public/index.js';
import type { HygieneService } from '../hygiene/public/index.js';
import { BriefingService, type RemoteAgendaPort } from './briefing-service.js';
import { ReviewService } from './review-service.js';
import { buildRitualJobHandlers } from './job-handlers.js';
import { BRIEFING_JOB_TYPE, REVISAO_JOB_TYPE, ensureDailyRitualJob } from './job-scheduling.js';

export const BRIEFING_HOUR_SETTING = 'rituals.briefingHour';
export const BRIEFING_MINUTE_SETTING = 'rituals.briefingMinute';
const BRIEFING_HOUR_DEFAULT = 7;
const BRIEFING_MINUTE_DEFAULT = 40;

export const REVISAO_HOUR_SETTING = 'rituals.revisaoHour';
export const REVISAO_MINUTE_SETTING = 'rituals.revisaoMinute';
const REVISAO_HOUR_DEFAULT = 21;
const REVISAO_MINUTE_DEFAULT = 30;

export interface BuildRitualsModuleDeps {
  readonly itemService: ItemService;
  readonly jobRepository: JobRepository;
  readonly outboxRepository: OutboxRepository;
  readonly llmProvider: LlmProvider;
  /**
   * Thunk, não lista pronta: assim como em `capture` (mesmo motivo, ver
   * comentário lá), o registry só está completo depois que `app.ts`
   * registra todos os módulos, e `rituals` nasce antes disso. Resolvido em
   * tempo de chamada (quando o job de briefing/revisão de fato dispara).
   */
  readonly getActiveModules: () => readonly PromptFragmentSource[];
  readonly ownerJid: string;
  readonly logger: Logger;
  readonly onUsage?: (usage: LlmUsage, intent: 'briefing' | 'revisao') => void;
  readonly agendaPort?: RemoteAgendaPort;
  /** Ausente só em teste que não exercita a proposta de higiene — em produção sempre presente (RF-11, FEAT-007). */
  readonly hygieneService?: HygieneService;
  readonly getBriefingHour: () => number;
  readonly getBriefingMinute: () => number;
  readonly getRevisaoHour: () => number;
  readonly getRevisaoMinute: () => number;
  now?: () => Date;
}

/**
 * `rituals` (RF-05, RF-06, spec FEAT-006): sem migração e sem tools
 * próprias nesta entrega — só jobs handlers. Tipos de job `briefing`/
 * `revisao` não exigem migração de schema porque `jobs.type` nunca teve
 * `CHECK` restringindo valores (só `jobs.status` tem); o vocabulário do ER
 * em ARCHITECTURE.md é documentação, não constraint de banco.
 */
export function buildRitualsModule(deps: BuildRitualsModuleDeps): { manifest: ModuleManifest } {
  const now = deps.now ?? (() => new Date());
  const systemPrompt = (): string => buildBrainSystemPrompt(deps.getActiveModules());

  const briefingService = new BriefingService({
    itemService: deps.itemService,
    llmProvider: deps.llmProvider,
    systemPrompt,
    logger: deps.logger,
    ...(deps.agendaPort ? { agendaPort: deps.agendaPort } : {}),
    ...(deps.onUsage ? { onUsage: (usage: LlmUsage) => deps.onUsage!(usage, 'briefing') } : {}),
    now,
  });

  const reviewService = new ReviewService({
    itemService: deps.itemService,
    llmProvider: deps.llmProvider,
    systemPrompt,
    logger: deps.logger,
    ...(deps.onUsage ? { onUsage: (usage: LlmUsage) => deps.onUsage!(usage, 'revisao') } : {}),
    ...(deps.hygieneService ? { hygieneService: deps.hygieneService } : {}),
    now,
  });

  const jobs = buildRitualJobHandlers({
    briefingService,
    reviewService,
    outboxRepository: deps.outboxRepository,
    ownerJid: deps.ownerJid,
  });

  const manifest: ModuleManifest = {
    name: 'rituals',
    jobs,
    settingsDefaults: {
      [BRIEFING_HOUR_SETTING]: BRIEFING_HOUR_DEFAULT,
      [BRIEFING_MINUTE_SETTING]: BRIEFING_MINUTE_DEFAULT,
      [REVISAO_HOUR_SETTING]: REVISAO_HOUR_DEFAULT,
      [REVISAO_MINUTE_SETTING]: REVISAO_MINUTE_DEFAULT,
    },
  };

  return { manifest };
}

/**
 * Seed dos jobs diários (chamado uma vez no boot, depois das migrações e do
 * `settings.seedDefaults` — precisa dos valores default já gravados para ler
 * o horário configurado). Idempotente: não duplica se o job já existe de um
 * boot anterior (`ensureDailyRitualJob`).
 */
export function seedRitualJobs(deps: BuildRitualsModuleDeps, jobRepository: JobRepository): void {
  const now = deps.now ?? (() => new Date());
  ensureDailyRitualJob(jobRepository, BRIEFING_JOB_TYPE, deps.getBriefingHour(), deps.getBriefingMinute(), now());
  ensureDailyRitualJob(jobRepository, REVISAO_JOB_TYPE, deps.getRevisaoHour(), deps.getRevisaoMinute(), now());
}
