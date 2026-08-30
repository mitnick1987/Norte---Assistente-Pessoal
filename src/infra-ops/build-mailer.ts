import { SmtpMailer, ResendMailer, type Mailer } from './mailer.js';

export interface MailerConfig {
  readonly smtpUrl: string | undefined;
  readonly resendApiKey: string | undefined;
}

/** SMTP tem prioridade quando ambos configurados — escolha arbitrária e estável, documentada aqui para não virar ambiguidade silenciosa. */
export function buildMailer(config: MailerConfig): Mailer | undefined {
  if (config.smtpUrl) return new SmtpMailer(config.smtpUrl);
  if (config.resendApiKey) return new ResendMailer(config.resendApiKey);
  return undefined;
}
