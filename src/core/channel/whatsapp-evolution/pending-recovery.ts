import type { Logger } from 'pino';
import type { AudioRecoveryData, MessageRepository } from '../message-repository.js';
import { parseSqliteUtcTimestamp, selectRecoveryCandidates } from '../domain/index.js';
import { processInboundText, type ProcessInboundDeps } from './webhook-route.js';
import { MediaUnavailableError } from './evolution-client.js';

/**
 * Recuperação de áudio (FEAT-003, spec item 4): busca a mídia de novo (a
 * `key` e o `mimeType` originais sobrevivem em `audioRecoveryData`) e
 * transcreve. Erro de mídia indisponível/expirada é distinguido de qualquer
 * outra falha porque o chamador (`recoverPendingMessages`) precisa decidir
 * `processed` vs `failed` de forma diferente — nunca com base em texto de
 * mensagem de erro.
 */
export type AudioRecoveryHandler = (recoveryData: AudioRecoveryData, jid: string, messageId: number) => Promise<void>;

export interface RecoverPendingMessagesDeps extends ProcessInboundDeps {
  readonly messageRepository: MessageRepository;
  readonly logger: Logger;
  readonly onAudioRecovery?: AudioRecoveryHandler;
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
 * Mensagem sem texto e sem mídia de áudio (imagem/outro, fora de escopo)
 * não tem caminho de reprocessamento — só é marcada `processed` para não
 * ficar `pending` para sempre, mesmo comportamento do webhook.
 */
export async function recoverPendingMessages(
  deps: RecoverPendingMessagesDeps,
  thresholdMs: number,
  maxPerBoot: number,
): Promise<void> {
  const now = deps.now ?? (() => new Date());

  const pending = deps.messageRepository.findPendingInbound().map((row) => ({
    id: row.id,
    jid: row.jid,
    body: row.body,
    createdAt: parseSqliteUtcTimestamp(row.createdAt),
    mediaType: row.mediaType,
    audioRecoveryData: row.audioRecoveryData,
  }));

  const candidates = selectRecoveryCandidates(pending, now(), thresholdMs);
  // Sem teto, dias de fila (máquina desligada, ADR-013) virariam rajada de
  // LLM+envios na subida; o que sobra sai no boot seguinte.
  const eligible = candidates.slice(0, maxPerBoot);
  const leftBehind = candidates.length - eligible.length;

  deps.logger.info({ count: eligible.length, leftBehind }, 'varredura de recuperação de mensagens pendentes no boot');
  if (leftBehind > 0) {
    deps.logger.warn({ leftBehind }, 'varredura atingiu o teto por boot; restantes ficam para a próxima subida');
  }

  for (const message of eligible) {
    if (message.mediaType === 'audio') {
      await recoverAudioMessage(message, deps);
      continue;
    }

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

interface RecoveryCandidate {
  readonly id: number;
  readonly jid: string;
  readonly audioRecoveryData: AudioRecoveryData | undefined;
}

async function recoverAudioMessage(message: RecoveryCandidate, deps: RecoverPendingMessagesDeps): Promise<void> {
  if (!deps.onAudioRecovery || !message.audioRecoveryData) {
    deps.messageRepository.markProcessed(message.id);
    return;
  }

  try {
    await deps.onAudioRecovery(message.audioRecoveryData, message.jid, message.id);
    deps.messageRepository.markProcessed(message.id);
  } catch (err) {
    if (err instanceof MediaUnavailableError) {
      // Mídia com TTL que já passou nunca vai ter sucesso numa tentativa
      // futura (spec item 4) — `processed` reflete que o sistema tratou o
      // caso da forma possível (pediu texto), não uma falha a reter.
      deps.logger.warn({ messageId: message.id }, 'mídia de áudio expirada na varredura de recuperação, pedindo texto');
      deps.messageRepository.markProcessed(message.id);
      return;
    }

    deps.messageRepository.markFailed(message.id);
    deps.logger.error({ err, messageId: message.id }, 'falha ao reprocessar áudio pendente no boot');
  }
}
