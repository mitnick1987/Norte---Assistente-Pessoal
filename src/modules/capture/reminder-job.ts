import { z } from 'zod';
import type { JobHandler, JobHandlerContext } from '../../core/kernel/types.js';
import type { OutboxRepository } from '../../core/outbox/index.js';
import { buildManhaMessage, buildPreparoMessage, buildVesperaMessage } from '../chains/public/index.js';
import { buildPointReminderMessage } from './domain/index.js';

const pointReminderPayloadSchema = z.object({
  itemId: z.number().int().positive(),
  title: z.string().min(1),
  tipoCadeia: z.undefined(),
});

/**
 * Payload da cadeia (FEAT-004): `startAt` chega como ISO — o handler
 * recalcula o tempo restante do alerta de preparo no momento do disparo
 * (`now` injetado), nunca no momento em que o job foi criado, para o texto
 * refletir o atraso real de poll/retry em vez de um número congelado.
 */
const chainReminderPayloadSchema = z.object({
  itemId: z.number().int().positive(),
  eventId: z.number().int().positive(),
  title: z.string().min(1),
  startAt: z.string().datetime(),
  deslocamentoMin: z.number().int().nonnegative(),
  tipoCadeia: z.enum(['vespera', 'manha', 'preparo']),
});

const reminderPayloadSchema = z.union([chainReminderPayloadSchema, pointReminderPayloadSchema]);

function buildMessage(
  payload: z.infer<typeof reminderPayloadSchema>,
  now: () => Date,
  seed: () => number,
): string {
  if (payload.tipoCadeia === undefined) {
    return buildPointReminderMessage(payload.title);
  }

  if (payload.tipoCadeia === 'vespera') return buildVesperaMessage(payload.title, seed());
  if (payload.tipoCadeia === 'manha') return buildManhaMessage(payload.title, seed());

  const minutesRemaining = (new Date(payload.startAt).getTime() - now().getTime()) / 60_000;
  return buildPreparoMessage(payload.title, minutesRemaining, seed());
}

/**
 * Handler do job `reminder` (RF-03/RF-04): caminho 100% determinístico, sem
 * chamada de LLM — o scheduler (core/scheduler) já garante o disparo
 * durável, aqui só monta o template e enfileira no outbox. `tipoCadeia`
 * presente no payload distingue etapa de cadeia (FEAT-004) de lembrete
 * pontual avulso (FEAT-002, inalterado).
 */
export function buildReminderJobHandler(deps: {
  outboxRepository: OutboxRepository;
  ownerJid: string;
  now?: () => Date;
}): JobHandler {
  const now = deps.now ?? (() => new Date());

  return async (ctx: JobHandlerContext): Promise<void> => {
    const payload = reminderPayloadSchema.parse(ctx.payload);
    deps.outboxRepository.enqueue({
      jid: deps.ownerJid,
      body: buildMessage(payload, now, () => now().getTime()),
      jobId: ctx.jobId,
      isProactive: true,
    });
  };
}
