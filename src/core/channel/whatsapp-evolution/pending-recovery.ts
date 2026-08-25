import type { Logger } from 'pino';
import type { MessageRepository } from '../message-repository.js';
import { parseSqliteUtcTimestamp, selectRecoveryCandidates } from '../domain/index.js';
import { processInboundText, type ProcessInboundDeps } from './webhook-route.js';

export interface RecoverPendingMessagesDeps extends ProcessInboundDeps {
  readonly messageRepository: MessageRepository;
  readonly logger: Logger;
  /** Injetável para teste — nunca `Date.now()` direto no domínio (TESTING.md §7). */
  now?: () => Date;
}

/**
 * Varredura de recuperação no boot (ADR-018): mensagens de entrada que
 * ficaram `pending` — processo derrubado no meio de
 * triagem→captura→confirmação — são reprocessadas pelo MESMO caminho do
 * fluxo normal, nunca uma segunda implementação. Idempotência da gravação
 * de itens é responsabilidade de `CaptureService.captureItems`
 * (`source_message_id`); aqui só decidimos QUAIS mensagens reprocessar.
 *
 * Mensagem sem texto (áudio/imagem, fora de escopo desta feature) não tem
 * caminho de reprocessamento — só é marcada `processed` para não ficar
 * `pending` para sempre, mesmo comportamento do webhook (ver
 * webhook-route.ts, ramo sem `incoming.kind === 'text'`).
 */
export async function recoverPendingMessages(deps: RecoverPendingMessagesDeps, thresholdMs: number): Promise<void> {
  const now = deps.now ?? (() => new Date());

  const pending = deps.messageRepository.findPendingInbound().map((row) => ({
    id: row.id,
    jid: row.jid,
    body: row.body,
    createdAt: parseSqliteUtcTimestamp(row.createdAt),
  }));

  const eligible = selectRecoveryCandidates(pending, now(), thresholdMs);

  deps.logger.info({ count: eligible.length }, 'varredura de recuperação de mensagens pendentes no boot');

  for (const message of eligible) {
    if (!message.body) {
      deps.messageRepository.markProcessed(message.id);
      continue;
    }

    try {
      await processInboundText(message.body, message.jid, message.id, deps);
      deps.messageRepository.markProcessed(message.id);
    } catch (err) {
      deps.messageRepository.markFailed(message.id);
      deps.logger.error({ err, messageId: message.id }, 'falha ao reprocessar mensagem pendente no boot');
    }
  }
}
