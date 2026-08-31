import { describe, expect, it, vi } from 'vitest';
import { jsonResponse, stubFetch } from '../factories/fetch-stub.js';

const sendMailMock = vi.fn();
const createTransportMock = vi.fn((_url: string) => ({ sendMail: sendMailMock }));

vi.mock('nodemailer', () => ({
  default: {
    createTransport: (url: string) => createTransportMock(url),
  },
}));

describe('SmtpMailer', () => {
  it('envia com o From explícito (ALERT_EMAIL_FROM) quando fornecido', async () => {
    sendMailMock.mockResolvedValueOnce(undefined);
    const { SmtpMailer } = await import('../../src/infra-ops/mailer.js');
    const mailer = new SmtpMailer('smtps://user:pass@smtp.test:465', 'alertas@dono-verificado.com');

    await mailer.send({ to: 'dono@example.com', subject: 'assunto', text: 'corpo' });

    expect(createTransportMock).toHaveBeenCalledWith('smtps://user:pass@smtp.test:465');
    expect(sendMailMock).toHaveBeenCalledWith({
      from: 'alertas@dono-verificado.com',
      to: 'dono@example.com',
      subject: 'assunto',
      text: 'corpo',
    });
  });

  it('sem ALERT_EMAIL_FROM, usa o usuário autenticado embutido na própria SMTP_URL (SPF/DKIM-safe)', async () => {
    sendMailMock.mockResolvedValueOnce(undefined);
    const { SmtpMailer } = await import('../../src/infra-ops/mailer.js');
    // username URL-encoded (%40 = @) — caso real de provedor que usa o
    // e-mail completo como usuário de autenticação SMTP.
    const mailer = new SmtpMailer('smtps://usuario-smtp%40provedor.com:senha@smtp.test:465', undefined);

    await mailer.send({ to: 'dono@example.com', subject: 'assunto', text: 'corpo' });

    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({ from: 'usuario-smtp@provedor.com' }),
    );
  });

  it('nunca usa onboarding@resend.dev como From — esse sandbox é exclusivo do ResendMailer', async () => {
    sendMailMock.mockResolvedValueOnce(undefined);
    const { SmtpMailer } = await import('../../src/infra-ops/mailer.js');
    const mailer = new SmtpMailer('smtps://user:pass@smtp.test:465', 'alertas@dono-verificado.com');

    await mailer.send({ to: 'dono@example.com', subject: 'assunto', text: 'corpo' });

    const call = sendMailMock.mock.calls[0]![0] as { from: string };
    expect(call.from).not.toContain('resend.dev');
  });

  it('sem ALERT_EMAIL_FROM e sem usuário na SMTP_URL, lança no construtor em vez de mandar um From alheio ao provedor', async () => {
    const { SmtpMailer } = await import('../../src/infra-ops/mailer.js');

    expect(() => new SmtpMailer('smtps://smtp.test:465', undefined)).toThrow(/From/);
  });

  it('propaga a falha do transporte para quem chama (EmailAlerter decide o fallback)', async () => {
    sendMailMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const { SmtpMailer } = await import('../../src/infra-ops/mailer.js');
    const mailer = new SmtpMailer('smtps://user:pass@smtp.test:465', 'alertas@dono-verificado.com');

    await expect(mailer.send({ to: 'dono@example.com', subject: 'x', text: 'y' })).rejects.toThrow('ECONNREFUSED');
  });
});

describe('ResendMailer', () => {
  it('envia via POST à API do Resend com o From fixo do sandbox e o header de autenticação', async () => {
    const { calls } = stubFetch(() => jsonResponse(200, { id: 'email_1' }));
    const { ResendMailer } = await import('../../src/infra-ops/mailer.js');
    const mailer = new ResendMailer('resend-key');

    await mailer.send({ to: 'dono@example.com', subject: 'assunto', text: 'corpo' });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.resend.com/emails');
    const headers = calls[0]!.init!.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer resend-key');
    const body = JSON.parse(calls[0]!.init!.body as string) as {
      to: string[];
      subject: string;
      text: string;
      from: string;
    };
    expect(body).toEqual({
      from: 'Norte <onboarding@resend.dev>',
      to: ['dono@example.com'],
      subject: 'assunto',
      text: 'corpo',
    });
  });

  it('resposta não-2xx do Resend lança erro sem ecoar o corpo da resposta (pode conter payload sensível)', async () => {
    stubFetch(() => jsonResponse(401, { message: 'invalid key' }));
    const { ResendMailer } = await import('../../src/infra-ops/mailer.js');
    const mailer = new ResendMailer('resend-key-invalida');

    await expect(mailer.send({ to: 'dono@example.com', subject: 'x', text: 'y' })).rejects.toThrow('Resend respondeu 401');
  });
});
