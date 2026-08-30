import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Logger } from 'pino';
import { z } from 'zod';
import type { CommandMatcher } from '../../kernel/types.js';
import type { MessageRepository } from '../message-repository.js';
import type { OutboxRepository } from '../../outbox/index.js';
import type { IncomingAudio } from '../channel.js';
import type { ConnectionWatchdog } from './connection-watchdog.js';
import { evolutionWebhookSchema } from './webhook-schema.js';
import { isEchoOfOwnMessage, normalizeIncomingMessage } from './normalize.js';
import { isFromOwner } from './owner-filter.js';

/**
 * Ponto de extensão para módulos de processamento (capture) que não têm
 * lugar no `ModuleManifest` — o core não conhece módulos (ARCHITECTURE.md
 * §2), então o webhook chama isso sem importar `capture` diretamente.
 * `messageId` viaja junto (ADR-018): é o vínculo que a captura grava em
 * `items.source_message_id` para a varredura de recuperação detectar
 * reprocessamento e não duplicar a gravação.
 */
export type UnmatchedTextHandler = (text: string, jid: string, messageId: number) => Promise<void>;

/**
 * Ponto de extensão para áudio (FEAT-003): simétrico ao de texto, mas o
 * core não sabe nada de STT nem de mídia — só entrega a `messageKey` (para
 * `getBase64FromMediaMessage`) e os metadados já normalizados do payload.
 * Responsabilidade de busca de mídia + STT + fallback de falha total é
 * inteira do handler (módulo `capture`, spec item 1/3).
 */
export type AudioMessageHandler = (
  audio: IncomingAudio,
  messageKey: unknown,
  jid: string,
  messageId: number,
) => Promise<void>;

export interface WebhookRouteDeps {
  readonly webhookSecret: string;
  readonly instance: string;
  readonly ownerJid: string;
  readonly messageRepository: MessageRepository;
  readonly outboxRepository: OutboxRepository;
  readonly commands: readonly CommandMatcher[];
  readonly connectionWatchdog: ConnectionWatchdog;
  readonly logger: Logger;
  /** Ausente = comportamento da FEAT-001 (silêncio quando nenhum comando bate). */
  readonly onUnmatchedText?: UnmatchedTextHandler;
  /** Ausente = áudio não tem processamento (comportamento pré-FEAT-003: só registra e marca `processed`). */
  readonly onAudioMessage?: AudioMessageHandler;
  /**
   * Ponto de extensão para o modo retorno (RF-10, FEAT-007): chamado para
   * toda mensagem de entrada nova (texto ou áudio, dedup já resolvido),
   * antes do processamento normal — decide se é a reativação e, se for,
   * enfileira o resumo de reentrada. Ausente só em teste que não exercita o
   * modo retorno; nunca bloqueia o 2xx nem o processamento principal.
   */
  readonly onInboundRecorded?: (jid: string, messageId: number) => void;
}

export interface ProcessInboundDeps {
  readonly ownerJid: string;
  readonly commands: readonly CommandMatcher[];
  readonly outboxRepository: OutboxRepository;
  readonly onUnmatchedText?: UnmatchedTextHandler;
}

const headersSchema = z.object({
  'x-webhook-secret': z.string().min(1).optional(),
});

const querySchema = z.object({
  secret: z.string().min(1).optional(),
});

/**
 * timingSafeEqual exige buffers do mesmo tamanho — hasheamos os dois lados
 * antes de comparar para não vazar o comprimento do segredo real via um
 * throw de tamanho incompatível (e para nunca cair no `!==` sensível a timing).
 */
function secretsMatch(provided: string, expected: string): boolean {
  const providedHash = createHash('sha256').update(provided).digest();
  const expectedHash = createHash('sha256').update(expected).digest();
  return timingSafeEqual(providedHash, expectedHash);
}

/**
 * A Evolution 2.3.7 não garante entrega de headers customizados no webhook
 * (webhook-provisioner.ts documenta o porquê) — o provisionamento real
 * embute o segredo na query string da URL. O header continua aceito para
 * compatibilidade com quem chamar a rota diretamente (testes, versão futura
 * da Evolution que suporte headers).
 */
function extractProvidedSecret(request: FastifyRequest): string | undefined {
  const headerCheck = headersSchema.safeParse(request.headers);
  if (headerCheck.success && headerCheck.data['x-webhook-secret']) {
    return headerCheck.data['x-webhook-secret'];
  }

  const queryCheck = querySchema.safeParse(request.query);
  if (queryCheck.success && queryCheck.data.secret) {
    return queryCheck.data.secret;
  }

  return undefined;
}

/**
 * Processamento de fato (triagem→captura→confirmação ou comando
 * determinístico) — ADR-018: roda em background, nunca segura o 2xx do
 * webhook. Também é o caminho que a varredura de recuperação no boot chama
 * de novo para mensagens `pending` (mesma função, sem duplicar lógica).
 *
 * Decisão de escopo: comandos determinísticos ("feito", "adia" etc.) não
 * fazem I/O de LLM e seriam baratos o bastante para rodar antes do 2xx, mas
 * uniformizar tudo num único caminho rastreável por `processing_status`
 * (pending/processed/failed) é mais simples e evita duas máquinas de estado
 * paralelas — o overhead de um comando síncrono virar background é
 * desprezível perto do ganho de ter um único lugar que marca conclusão.
 */
export async function processInboundText(text: string, jid: string, messageId: number, deps: ProcessInboundDeps): Promise<void> {
  const matcher = deps.commands.find((command) => command.match({ text, ownerJid: deps.ownerJid }));

  if (!matcher) {
    await deps.onUnmatchedText?.(text, jid, messageId);
    return;
  }

  const result = await matcher.handle({ text, ownerJid: deps.ownerJid });
  deps.outboxRepository.enqueue({ jid, body: result.replyText, isProactive: false });
}

/**
 * Única entrada HTTP externa do sistema (ARCHITECTURE.md §5). Ordem das
 * checagens importa e é a mesma exigida por SECURITY.md §2: segredo →
 * validação de contrato → instância → JID do dono → dedup — cada etapa
 * fail-closed, nenhuma pula para a próxima em caso de dúvida.
 *
 * ADR-018: depois do dedup, a mensagem já está persistida como `pending` —
 * o 2xx sai imediatamente e o processamento roda numa promise não aguardada.
 * A Evolution não pode ficar de conexão aberta esperando a triagem (até 15s).
 */
export function registerEvolutionWebhookRoute(app: FastifyInstance, deps: WebhookRouteDeps): void {
  app.post('/webhook/evolution', async (request: FastifyRequest, reply: FastifyReply) => {
    const providedSecret = extractProvidedSecret(request);
    if (!providedSecret || !secretsMatch(providedSecret, deps.webhookSecret)) {
      deps.logger.warn('webhook rejeitado: segredo ausente ou inválido');
      return reply.code(401).send({ error: 'unauthorized' });
    }

    const payloadCheck = evolutionWebhookSchema.safeParse(request.body);
    if (!payloadCheck.success) {
      deps.logger.warn({ issues: payloadCheck.error.issues }, 'webhook rejeitado: payload malformado');
      return reply.code(400).send({ error: 'invalid_payload' });
    }

    const event = payloadCheck.data;

    if (event.instance !== deps.instance) {
      deps.logger.warn({ instance: event.instance }, 'webhook ignorado: instância diferente da configurada');
      return reply.code(200).send({ ignored: true });
    }

    if (event.event === 'connection.update') {
      deps.connectionWatchdog.observe(event.data.state);
      return reply.code(200).send({ ok: true });
    }

    if (isEchoOfOwnMessage(event)) {
      return reply.code(200).send({ ignored: true });
    }

    const incoming = normalizeIncomingMessage(event);

    if (!isFromOwner(incoming.jid, deps.ownerJid)) {
      deps.logger.warn({ jid: incoming.jid }, 'webhook ignorado: JID diferente do dono');
      return reply.code(200).send({ ignored: true });
    }

    // key.id é opcional no contrato (schema permissivo, webhook-schema.ts) mas
    // o dedup depende dele: sem id o índice único parcial não pega reentregas
    // e um payload degradado processaria o mesmo comando várias vezes
    // (SECURITY.md §6, idempotência). Fail-closed: rejeita em vez de arriscar.
    if (!incoming.waMessageId) {
      deps.logger.warn({ jid: incoming.jid }, 'webhook ignorado: mensagem sem wa_message_id, dedup impossível');
      return reply.code(200).send({ ignored: true });
    }

    const recorded = deps.messageRepository.tryRecordInbound({
      jid: incoming.jid,
      waMessageId: incoming.waMessageId,
      body: incoming.text,
      ...(incoming.kind === 'audio' && incoming.audio
        ? {
            mediaType: 'audio' as const,
            audioRecoveryData: { messageKey: incoming.messageKey, mimeType: incoming.audio.mimeType },
          }
        : {}),
    });

    if (!recorded.isNew) {
      deps.logger.info({ waMessageId: incoming.waMessageId }, 'webhook ignorado: mensagem duplicada (dedup)');
      return reply.code(200).send({ deduped: true });
    }

    // Síncrono e best-effort de propósito: só decide se enfileira o resumo
    // de reentrada (RF-10), nunca deveria derrubar o processamento principal
    // da mensagem por uma falha aqui.
    try {
      deps.onInboundRecorded?.(incoming.jid, recorded.messageId);
    } catch (err) {
      deps.logger.error({ err, messageId: recorded.messageId }, 'falha ao avaliar modo retorno na mensagem recebida');
    }

    if (incoming.kind === 'text' && incoming.text) {
      const messageId = recorded.messageId;
      const text = incoming.text;
      const jid = incoming.jid;

      // Disparo não aguardado de propósito (ADR-018): o 2xx não pode esperar
      // a triagem (LLM, até 15s). Erro aqui é sempre definitivo — qualquer
      // exceção que escape do processamento marca a mensagem como `failed`
      // e loga, nunca falha em silêncio.
      void processInboundText(text, jid, messageId, deps)
        .then(() => deps.messageRepository.markProcessed(messageId))
        .catch((err: unknown) => {
          deps.messageRepository.markFailed(messageId);
          deps.logger.error({ err, messageId, waMessageId: incoming.waMessageId }, 'falha ao processar mensagem recebida');
        });
    } else if (incoming.kind === 'audio' && incoming.audio && deps.onAudioMessage) {
      const messageId = recorded.messageId;
      const audio = incoming.audio;
      const messageKey = incoming.messageKey;
      const jid = incoming.jid;

      // Mesmo espírito do texto (ADR-018): busca de mídia + STT rodam em
      // background, o 2xx não espera nenhuma das duas.
      void deps
        .onAudioMessage(audio, messageKey, jid, messageId)
        .then(() => deps.messageRepository.markProcessed(messageId))
        .catch((err: unknown) => {
          deps.messageRepository.markFailed(messageId);
          deps.logger.error({ err, messageId, waMessageId: incoming.waMessageId }, 'falha ao processar áudio recebido');
        });
    } else {
      // Sem texto nem áudio processável (imagem/outro, fora de escopo) não
      // há processamento — a mensagem fica registrada mas não tem próximo passo.
      deps.messageRepository.markProcessed(recorded.messageId);
    }

    return reply.code(200).send({ ok: true });
  });
}
