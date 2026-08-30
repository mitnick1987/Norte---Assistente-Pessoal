import nodemailer from 'nodemailer';

export interface MailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

/** Transporte de envio real — implementações nunca lançam por conta própria em log; quem chama decide o fallback (EmailAlerter cai em log `error`). */
export interface Mailer {
  send: (message: MailMessage) => Promise<void>;
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
/** Remetente técnico fixo — Resend exige domínio verificado; `onboarding@resend.dev` é o sandbox padrão deles para quem ainda não verificou domínio próprio. */
const RESEND_DEFAULT_FROM = 'Norte <onboarding@resend.dev>';

/**
 * nodemailer com URL única de conexão (`SMTP_URL`, ex.:
 * `smtps://user:pass@host:465`) — não precisamos de pool nem de opções
 * avançadas para o volume de e-mail deste produto (alertas esporádicos de
 * infra, nunca notificação em massa).
 */
export class SmtpMailer implements Mailer {
  private readonly transporter: ReturnType<typeof nodemailer.createTransport>;

  constructor(smtpUrl: string) {
    this.transporter = nodemailer.createTransport(smtpUrl);
  }

  async send(message: MailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: RESEND_DEFAULT_FROM,
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
  }
}

/** Resend via API HTTP direta (fetch nativo do Node 22) — sem SDK para não adicionar dependência a um POST simples com um header de auth. */
export class ResendMailer implements Mailer {
  constructor(private readonly apiKey: string) {}

  async send(message: MailMessage): Promise<void> {
    const response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: RESEND_DEFAULT_FROM,
        to: [message.to],
        subject: message.subject,
        text: message.text,
      }),
    });

    if (!response.ok) {
      // Corpo do erro do Resend pode ecoar o payload da requisição — nunca
      // logado bruto (SECURITY.md §4); status basta para diagnóstico.
      throw new Error(`Resend respondeu ${response.status}`);
    }
  }
}
