import type { Logger } from 'pino';
import type { FailureAlerter } from '../core/outbox/alerter.js';

export interface EmailAlerterConfig {
  readonly smtpUrl: string | undefined;
  readonly alertEmail: string | undefined;
}

/**
 * Canal de alerta fora do WhatsApp (ARCHITECTURE.md §6). Sem cliente SMTP
 * nesta fundação — envio real entra junto com o primeiro RF que dependa
 * dele (RF-13, fora de escopo da FEAT-001); aqui a responsabilidade é só
 * logar em `error` para nunca haver falha silenciosa mesmo com o
 * transporte de e-mail ainda não implementado.
 */
export class EmailAlerter implements FailureAlerter {
  constructor(
    private readonly config: EmailAlerterConfig,
    private readonly logger: Logger,
  ) {}

  async alertDeliveryExhausted(message: { id: number; jid: string; attempts: number }): Promise<void> {
    if (!this.config.smtpUrl || !this.config.alertEmail) {
      this.logger.error({ message }, 'alerta de entrega esgotada sem transporte de e-mail configurado');
      return;
    }
    this.logger.error({ message, alertEmail: this.config.alertEmail }, 'alerta de entrega esgotada');
  }
}
