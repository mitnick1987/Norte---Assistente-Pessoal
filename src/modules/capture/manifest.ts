import type { Logger } from 'pino';
import type { ModuleManifest } from '../../core/kernel/types.js';
import type { LlmProvider } from '../../core/llm/index.js';
import type { JobRepository } from '../../core/scheduler/index.js';
import type { OutboxRepository } from '../../core/outbox/index.js';
import type { MessageRepository } from '../../core/channel/index.js';
import type { ItemService } from '../tasks/public/index.js';
import { TriageService } from './triage-service.js';
import { CaptureService } from './capture-service.js';
import { buildCaptureDispatcher } from './capture-dispatcher.js';
import { buildReminderJobHandler } from './reminder-job.js';

export interface CaptureModuleDeps {
  readonly llmProvider: LlmProvider;
  readonly itemService: ItemService;
  readonly jobRepository: JobRepository;
  readonly outboxRepository: OutboxRepository;
  readonly messageRepository: MessageRepository;
  readonly ownerJid: string;
  readonly logger: Logger;
}

const TRIAGE_INTENT = 'triagem';

/**
 * Limiar de idade da varredura de recuperação no boot (ADR-018): mensagem
 * `pending` mais nova que isso ainda pode estar em processamento normal (o
 * mesmo processo, sem crash) — só depois desse limiar ela é candidata a
 * reprocessamento. 60s é generoso frente ao timeout de 15s da triagem
 * (RF-01): mesmo um retry de rede dentro do provider não faria a mensagem
 * cruzar essa idade sem ter marcado `processed`/`failed`.
 */
export const PENDING_RECOVERY_THRESHOLD_MS_SETTING = 'capture.pendingRecoveryThresholdMs';
const PENDING_RECOVERY_THRESHOLD_MS_DEFAULT = 60_000;

/**
 * `capture` não tem migração própria — grava exclusivamente via o
 * contrato público de `tasks` e via `core/scheduler`/`core/outbox`
 * (ARCHITECTURE.md §2). O dispatcher fica disponível à parte (não é
 * tool/command/job do manifesto) porque o webhook o aciona via
 * `onUnmatchedText`, um ponto de extensão que não existe no
 * `ModuleManifest` — ver Decisões tomadas da FEAT-002.
 */
export function buildCaptureModule(deps: CaptureModuleDeps): {
  manifest: ModuleManifest;
  dispatch: (text: string, jid: string, messageId: number) => Promise<void>;
} {
  const triageService = new TriageService({
    provider: deps.llmProvider,
    logger: deps.logger,
    onUsage: (usage) =>
      deps.messageRepository.recordLlmUsage({
        jid: deps.ownerJid,
        intent: TRIAGE_INTENT,
        tokensIn: usage.tokensIn,
        tokensOut: usage.tokensOut,
        cacheReadTokens: usage.cacheReadTokens,
      }),
  });

  const captureService = new CaptureService(deps.itemService, deps.jobRepository);

  const dispatch = buildCaptureDispatcher({
    triageService,
    captureService,
    outboxRepository: deps.outboxRepository,
    logger: deps.logger,
  });

  const manifest: ModuleManifest = {
    name: 'capture',
    jobs: {
      reminder: buildReminderJobHandler({ outboxRepository: deps.outboxRepository, ownerJid: deps.ownerJid }),
    },
    settingsDefaults: {
      [PENDING_RECOVERY_THRESHOLD_MS_SETTING]: PENDING_RECOVERY_THRESHOLD_MS_DEFAULT,
    },
  };

  return { manifest, dispatch };
}
