import type { JobHandler } from '../../core/kernel/types.js';
import type { OutboxRepository } from '../../core/outbox/index.js';
import type { BriefingService } from './briefing-service.js';
import type { ReviewService } from './review-service.js';

export interface RitualJobHandlersDeps {
  readonly briefingService: BriefingService;
  readonly reviewService: ReviewService;
  readonly outboxRepository: OutboxRepository;
  readonly ownerJid: string;
}

/**
 * Handlers dos jobs `briefing`/`revisao` (RF-05, RF-06): o scheduler já
 * garante o disparo durável e o catch-up no boot (ADR-004) — aqui só
 * orquestra coleta+redação (com fallback embutido no service) e enfileira
 * no outbox. Nenhuma chamada de LLM acontece fora de `BriefingService`/
 * `ReviewService`; o handler não decide nada sobre tom ou conteúdo.
 */
export function buildRitualJobHandlers(deps: RitualJobHandlersDeps): Record<string, JobHandler> {
  return {
    briefing: async () => {
      const message = await deps.briefingService.buildMessage();
      deps.outboxRepository.enqueue({ jid: deps.ownerJid, body: message, isProactive: true });
    },
    revisao: async () => {
      const messages = await deps.reviewService.buildMessages();
      for (const message of messages) {
        deps.outboxRepository.enqueue({ jid: deps.ownerJid, body: message, isProactive: true });
      }
    },
  };
}
