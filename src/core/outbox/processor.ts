import type { Logger } from 'pino';
import {
  nextRetryDelayMs,
  proactiveCapReached,
  randomSendDelayMs,
  retriesExhausted,
} from './domain/index.js';
import { startOfZonedDay, zonedTimeToUtc } from '../scheduler/domain/timezone.js';
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
  /**
   * Guard de execução única: processo único (ADR-004), então uma flag em
   * memória basta. Sem isso, o tick de 5s do timer e um disparo direto
   * (ex.: outro caminho que force o processamento) podem se intercalar
   * durante o sleep do delay anti-banimento e enviar a mesma mensagem 2x.
   */
  private isRunning = false;

  constructor(private readonly deps: OutboxProcessorDeps) {
    this.now = deps.now ?? (() => new Date());
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.random = deps.random ?? Math.random;
  }

  async processPending(): Promise<void> {
    if (this.isRunning) {
      this.deps.logger.warn('processPending já em execução, tick ignorado');
      return;
    }

    this.isRunning = true;
    try {
      const pending = this.deps.repository.findPending(this.now().toISOString());
      for (const message of pending) {
        await this.processOne(message);
      }
    } finally {
      this.isRunning = false;
    }
  }

  private async processOne(message: OutboxMessageRow): Promise<void> {
    if (message.is_proactive) {
      // Dia civil de America/Sao_Paulo, não janela rolante de 24h — o teto
      // "diário" tem que zerar à meia-noite local, não 24h atrás de agora
      // (CODE_STYLE §2, daily-cap.ts).
      const sinceIso = zonedTimeToUtc(startOfZonedDay(this.now())).toISOString();
      const sentToday = this.deps.repository.countProactiveSentSince(sinceIso);
      if (proactiveCapReached(sentToday, this.deps.dailyProactiveCap)) {
        this.deps.logger.warn({ messageId: message.id }, 'teto diário de proativas atingido, mensagem represada');
        return;
      }
    }

    // Claim atômico: se outra execução já pegou essa linha entre o
    // findPending e aqui, desiste sem reenviar (evita duplicar envio).
    if (!this.deps.repository.claimForSending(message.id)) {
      return;
    }

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
