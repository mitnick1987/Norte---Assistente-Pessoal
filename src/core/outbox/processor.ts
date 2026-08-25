import type { Logger } from 'pino';
import {
  nextRetryDelayMs,
  proactiveCapReached,
  randomSendDelayMs,
  retriesExhausted,
} from './domain/index.js';
import type { OutboxRepository, OutboxMessageRow } from './outbox-repository.js';
import type { MessageSender } from './sender.js';
import type { FailureAlerter } from './alerter.js';

export interface OutboxProcessorDeps {
  readonly repository: OutboxRepository;
  readonly sender: MessageSender;
  readonly alerter: FailureAlerter;
  readonly logger: Logger;
  readonly dailyProactiveCap: number;
  /**
   * Callback pós-confirmação — hoje usado para registrar a mensagem de
   * saída em `messages` (auditoria/custo, RF-15). Callback em vez de
   * injetar MessageRepository direto: outbox não deveria depender de
   * channel/ (evita acoplamento circular entre subpastas do core).
   */
  onDelivered?: (message: { jid: string; body: string }) => void;
  /** Injetáveis para teste — nunca setTimeout/Math.random reais no domínio (TESTING.md §7). */
  now?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const DAY_IN_MS = 24 * 60 * 60 * 1000;

/**
 * Processa a fila pendente: aplica o teto diário de proativas no backend
 * (nunca só no prompt), aguarda o delay anti-banimento + sendPresence antes
 * de mensagens proativas, confirma só pós-2xx, e escala por e-mail quando
 * o retry exponencial se esgota — nunca falha em silêncio.
 */
export class OutboxProcessor {
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;

  constructor(private readonly deps: OutboxProcessorDeps) {
    this.now = deps.now ?? (() => new Date());
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.random = deps.random ?? Math.random;
  }

  async processPending(): Promise<void> {
    const pending = this.deps.repository.findPending(this.now().toISOString());
    for (const message of pending) {
      await this.processOne(message);
    }
  }

  private async processOne(message: OutboxMessageRow): Promise<void> {
    if (message.is_proactive) {
      const sinceIso = new Date(this.now().getTime() - DAY_IN_MS).toISOString();
      const sentToday = this.deps.repository.countProactiveSentSince(sinceIso);
      if (proactiveCapReached(sentToday, this.deps.dailyProactiveCap)) {
        this.deps.logger.warn({ messageId: message.id }, 'teto diário de proativas atingido, mensagem represada');
        return;
      }
    }

    this.deps.repository.markSending(message.id);

    try {
      if (message.is_proactive) {
        await this.sleep(randomSendDelayMs(this.random));
        await this.deps.sender.sendPresence(message.jid);
      }
      await this.deps.sender.sendText(message.jid, message.body);

      this.deps.repository.markDelivered(message.id, this.now());
      this.deps.onDelivered?.({ jid: message.jid, body: message.body });
    } catch (err) {
      await this.handleSendFailure(message, err);
    }
  }

  private async handleSendFailure(message: OutboxMessageRow, err: unknown): Promise<void> {
    this.deps.repository.incrementAttempts(message.id);
    const attempts = message.attempts + 1;

    if (retriesExhausted(attempts)) {
      this.deps.repository.markFailed(message.id);
      this.deps.logger.error({ messageId: message.id, attempts, err }, 'retries esgotados, alertando');
      await this.deps.alerter.alertDeliveryExhausted({ id: message.id, jid: message.jid, attempts });
      return;
    }

    const retryAfter = new Date(this.now().getTime() + nextRetryDelayMs(attempts));
    this.deps.repository.markPendingForRetry(message.id, retryAfter);
    this.deps.logger.warn({ messageId: message.id, attempts, err }, 'falha ao enviar, retry agendado');
  }
}
