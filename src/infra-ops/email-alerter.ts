import type { Logger } from 'pino';
import type { FailureAlerter } from '../core/outbox/alerter.js';
import type { Mailer } from './mailer.js';
import type { AlertDispatchRepository } from './alert-dispatch-repository.js';
import { sanitizeErrorMessage } from './domain/error-sanitizer.js';
import {
  anchorRitualCappedMessage,
  cacheRegressionMessage,
  costBudgetExceededMessage,
  deliveryExhaustedMessage,
  diskUsageMessage,
  refreshFailureMessage,
  sessionDownMessage,
} from './domain/alert-templates.js';

export interface EmailAlerterConfig {
  readonly alertEmail: string | undefined;
  /**
   * Janela de anti-flood por chave lógica (spec item 1, Decisões tomadas) —
   * thunk porque `settings` (SQLite) só termina de semear defaults depois
   * que `app.ts` roda `seedDefaults` (o `EmailAlerter` nasce antes disso) —
   * ler uma vez no construtor congelaria o valor em `undefined` para sempre.
   */
  readonly getAntiFloodWindowMs: () => number;
}

/**
 * Canal de alerta fora do WhatsApp (ARCHITECTURE.md §6). `mailer` ausente
 * (nenhum transporte configurado, nem SMTP nem Resend) faz todo alerta cair
 * em log `error` — nunca falha em silêncio mesmo sem credencial nenhuma.
 * Anti-flood por chave lógica: mesma falha não reenvia dentro da janela,
 * mas tipos diferentes de alerta nunca competem pela mesma cota (spec,
 * Decisões tomadas).
 */
export class EmailAlerter implements FailureAlerter {
  constructor(
    private readonly config: EmailAlerterConfig,
    private readonly mailer: Mailer | undefined,
    private readonly dispatchRepository: AlertDispatchRepository,
    private readonly logger: Logger,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async dispatch(alertKey: string, build: () => { subject: string; text: string }, logPayload: Record<string, unknown>): Promise<void> {
    if (!this.mailer || !this.config.alertEmail) {
      this.logger.error(logPayload, 'alerta sem transporte de e-mail configurado');
      return;
    }

    // Claim atômico ANTES do envio (achado de review FEAT-008): reivindica
    // o slot da janela de anti-flood numa única operação síncrona do
    // SQLite, fechando a corrida que existia entre ler "fora da janela" e
    // gravar só depois do envio assíncrono — dois disparos concorrentes da
    // mesma chave não passam mais os dois pelo `mailer.send`.
    const claimed = this.dispatchRepository.tryClaim(alertKey, this.now(), this.config.getAntiFloodWindowMs());
    if (!claimed) {
      this.logger.info({ alertKey }, 'alerta suprimido pelo anti-flood (mesma chave dentro da janela)');
      return;
    }

    const { subject, text } = build();
    try {
      await this.mailer.send({ to: this.config.alertEmail, subject, text });
    } catch (err) {
      // Falha de envio não tem canal acima do e-mail para escalar (spec,
      // Decisões tomadas) — só log `error`. `err` nunca bruto: pode carregar
      // corpo de resposta do provedor SMTP/Resend com credencial embutida.
      const rawMessage = err instanceof Error ? err.message : 'erro desconhecido';
      const message = sanitizeErrorMessage(rawMessage);
      this.logger.error({ ...logPayload, message }, 'falha ao enviar e-mail de alerta');
    }
  }

  async alertDeliveryExhausted(message: { id: number; jid: string; attempts: number }): Promise<void> {
    await this.dispatch(
      `delivery_exhausted:${message.id}`,
      () => deliveryExhaustedMessage(message),
      { message },
    );
  }

  async alertRefreshFailure(context: { provider: string; err: unknown }): Promise<void> {
    // `err` nunca entra bruto no log estruturado (pode carregar corpo de
    // resposta do provedor com token/segredo embutido) — só o provider e a
    // mensagem já bastam para o dono investigar (SECURITY.md §4).
    const rawMessage = context.err instanceof Error ? context.err.message : 'erro desconhecido';
    const message = sanitizeErrorMessage(rawMessage);
    await this.dispatch(
      `refresh_failure:${context.provider}`,
      () => refreshFailureMessage(context.provider),
      { provider: context.provider, message },
    );
  }

  async alertAnchorRitualCapped(message: { id: number; jid: string }): Promise<void> {
    await this.dispatch(
      `anchor_ritual_capped:${message.id}`,
      () => anchorRitualCappedMessage(message),
      { message },
    );
  }

  async alertSessionDown(context: { state: string }): Promise<void> {
    await this.dispatch(
      'session_down',
      () => sessionDownMessage(context.state),
      { state: context.state },
    );
  }

  async alertDiskUsage(context: { usagePercent: number; thresholdPercent: number }): Promise<void> {
    await this.dispatch(
      'disk_usage',
      () => diskUsageMessage(context),
      { usagePercent: context.usagePercent, thresholdPercent: context.thresholdPercent },
    );
  }

  async alertCostBudgetExceeded(context: { projectedMonthlyCostUsd: number; budgetUsd: number }): Promise<void> {
    await this.dispatch(
      'cost_budget_exceeded',
      () => costBudgetExceededMessage(context),
      { projectedMonthlyCostUsd: context.projectedMonthlyCostUsd, budgetUsd: context.budgetUsd },
    );
  }

  async alertCacheRegression(): Promise<void> {
    await this.dispatch('cache_regression', () => cacheRegressionMessage(), {});
  }
}
