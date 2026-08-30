import { z } from 'zod';
import type { JobHandler, JobHandlerContext } from '../../core/kernel/types.js';
import type { OutboxRepository } from '../../core/outbox/index.js';
import { buildPointReminderMessage } from './domain/index.js';

const reminderPayloadSchema = z.object({
  itemId: z.number().int().positive(),
  title: z.string().min(1),
});

/**
 * Handler do job `reminder` (RF-03): caminho 100% determinístico, sem
 * chamada de LLM — o scheduler (core/scheduler) já garante o disparo
 * durável, aqui só monta o template e enfileira no outbox.
 */
export function buildReminderJobHandler(deps: { outboxRepository: OutboxRepository; ownerJid: string }): JobHandler {
  return async (ctx: JobHandlerContext): Promise<void> => {
    const payload = reminderPayloadSchema.parse(ctx.payload);
    deps.outboxRepository.enqueue({
      jid: deps.ownerJid,
      body: buildPointReminderMessage(payload.title),
      jobId: ctx.jobId,
      isProactive: true,
    });
  };
}
