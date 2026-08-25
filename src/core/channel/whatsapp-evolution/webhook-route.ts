import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Logger } from 'pino';
import { z } from 'zod';
import type { CommandMatcher } from '../../kernel/types.js';
import type { MessageRepository } from '../message-repository.js';
import type { OutboxRepository } from '../../outbox/index.js';
import type { ConnectionWatchdog } from './connection-watchdog.js';
import { evolutionWebhookSchema } from './webhook-schema.js';
import { isEchoOfOwnMessage, normalizeIncomingMessage } from './normalize.js';
import { isFromOwner } from './owner-filter.js';

export interface WebhookRouteDeps {
  readonly webhookSecret: string;
  readonly instance: string;
  readonly ownerJid: string;
  readonly messageRepository: MessageRepository;
  readonly outboxRepository: OutboxRepository;
  readonly commands: readonly CommandMatcher[];
  readonly connectionWatchdog: ConnectionWatchdog;
  readonly logger: Logger;
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
 * Única entrada HTTP externa do sistema (ARCHITECTURE.md §5). Ordem das
 * checagens importa e é a mesma exigida por SECURITY.md §2: segredo →
 * validação de contrato → instância → JID do dono → dedup — cada etapa
 * fail-closed, nenhuma pula para a próxima em caso de dúvida.
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

    const isNew = deps.messageRepository.tryRecordInbound({
      jid: incoming.jid,
      waMessageId: incoming.waMessageId,
      body: incoming.text,
    });

    if (!isNew) {
      deps.logger.info({ waMessageId: incoming.waMessageId }, 'webhook ignorado: mensagem duplicada (dedup)');
      return reply.code(200).send({ deduped: true });
    }

    await dispatchToCommands(incoming, deps);

    return reply.code(200).send({ ok: true });
  });
}

async function dispatchToCommands(
  incoming: ReturnType<typeof normalizeIncomingMessage>,
  deps: WebhookRouteDeps,
): Promise<void> {
  if (incoming.kind !== 'text' || !incoming.text) return;

  const matcher = deps.commands.find((command) => command.match({ text: incoming.text!, ownerJid: deps.ownerJid }));
  if (!matcher) return;

  const result = await matcher.handle({ text: incoming.text, ownerJid: deps.ownerJid });
  deps.outboxRepository.enqueue({ jid: incoming.jid, body: result.replyText, isProactive: false });
}
