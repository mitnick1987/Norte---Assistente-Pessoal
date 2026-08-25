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
    // e-mail do dono é PII e não entra no log estruturado — id/jid já bastam
    // para correlacionar o incidente (SECURITY.md §4 trata log como superfície
    // de vazamento mesmo sem ser secret de sistema).
    this.logger.error({ message }, 'alerta de entrega esgotada');
  }
}
