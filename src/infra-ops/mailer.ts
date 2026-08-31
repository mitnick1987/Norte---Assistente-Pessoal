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
/**
 * Remetente do sandbox do Resend — reservado exclusivamente ao ResendMailer.
 * Resend exige domínio verificado; `onboarding@resend.dev` é o sandbox
 * padrão deles para quem ainda não verificou domínio próprio. Nunca serve de
 * fallback para o SmtpMailer: um From de resend.dev num envio por SMTP de
 * outro provedor falha SPF/DKIM e o alerta não entrega — em silêncio, porque
 * o transporte não lança erro nenhum nesse caso.
 */
const RESEND_DEFAULT_FROM = 'Norte <onboarding@resend.dev>';

/** Extrai o usuário autenticado de uma SMTP_URL (`smtps://user:pass@host:465`) — é o endereço que o provedor já valida, então é sempre SPF/DKIM-safe. */
function fromSmtpUrlUser(smtpUrl: string): string | undefined {
  try {
    const parsed = new URL(smtpUrl);
    return parsed.username ? decodeURIComponent(parsed.username) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * nodemailer com URL única de conexão (`SMTP_URL`, ex.:
 * `smtps://user:pass@host:465`) — não precisamos de pool nem de opções
 * avançadas para o volume de e-mail deste produto (alertas esporádicos de
 * infra, nunca notificação em massa).
 */
export class SmtpMailer implements Mailer {
  private readonly transporter: ReturnType<typeof nodemailer.createTransport>;
  private readonly from: string;

  /**
   * `from` resolvido em ordem (spec item 1 do review FEAT-008): ALERT_EMAIL_FROM
   * explícita > usuário autenticado da própria SMTP_URL > ALERT_EMAIL (destino,
   * último recurso). Nunca `onboarding@resend.dev` — esse é exclusivo do Resend.
   */
  constructor(smtpUrl: string, from: string | undefined) {
    this.transporter = nodemailer.createTransport(smtpUrl);
    const resolved = from ?? fromSmtpUrlUser(smtpUrl);
    if (!resolved) {
      throw new Error('SmtpMailer: nenhum From resolvido (defina ALERT_EMAIL_FROM, ou embuta o usuário na SMTP_URL)');
    }
    this.from = resolved;
  }

  async send(message: MailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: this.from,
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
