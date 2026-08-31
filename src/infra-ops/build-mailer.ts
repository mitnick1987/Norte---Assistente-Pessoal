import { SmtpMailer, ResendMailer, type Mailer } from './mailer.js';

export interface MailerConfig {
  readonly smtpUrl: string | undefined;
  readonly resendApiKey: string | undefined;
  /** From explícito para o transporte SMTP (spec item 1 do review FEAT-008) — opcional, com fallback dentro do SmtpMailer. */
  readonly alertEmailFrom: string | undefined;
  /** Último recurso de From do SmtpMailer quando não há ALERT_EMAIL_FROM nem usuário embutido na SMTP_URL. */
  readonly alertEmail: string | undefined;
}

/** SMTP tem prioridade quando ambos configurados — escolha arbitrária e estável, documentada aqui para não virar ambiguidade silenciosa. */
export function buildMailer(config: MailerConfig): Mailer | undefined {
  if (config.smtpUrl) return new SmtpMailer(config.smtpUrl, config.alertEmailFrom ?? config.alertEmail);
  if (config.resendApiKey) return new ResendMailer(config.resendApiKey);
  return undefined;
}
