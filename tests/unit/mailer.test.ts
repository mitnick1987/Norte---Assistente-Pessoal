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
  it('envia e-mail via transporte SMTP construído a partir da SMTP_URL', async () => {
    sendMailMock.mockResolvedValueOnce(undefined);
    const { SmtpMailer } = await import('../../src/infra-ops/mailer.js');
    const mailer = new SmtpMailer('smtps://user:pass@smtp.test:465');

    await mailer.send({ to: 'dono@example.com', subject: 'assunto', text: 'corpo' });

    expect(createTransportMock).toHaveBeenCalledWith('smtps://user:pass@smtp.test:465');
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'dono@example.com', subject: 'assunto', text: 'corpo' }),
    );
  });

  it('propaga a falha do transporte para quem chama (EmailAlerter decide o fallback)', async () => {
    sendMailMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const { SmtpMailer } = await import('../../src/infra-ops/mailer.js');
    const mailer = new SmtpMailer('smtps://user:pass@smtp.test:465');

    await expect(mailer.send({ to: 'dono@example.com', subject: 'x', text: 'y' })).rejects.toThrow('ECONNREFUSED');
  });
});

describe('ResendMailer', () => {
  it('envia e-mail via POST à API do Resend com o header de autenticação', async () => {
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
    expect(body).toMatchObject({ to: ['dono@example.com'], subject: 'assunto', text: 'corpo' });
  });

  it('resposta não-2xx do Resend lança erro sem ecoar o corpo da resposta (pode conter payload sensível)', async () => {
    stubFetch(() => jsonResponse(401, { message: 'invalid key' }));
    const { ResendMailer } = await import('../../src/infra-ops/mailer.js');
    const mailer = new ResendMailer('resend-key-invalida');

    await expect(mailer.send({ to: 'dono@example.com', subject: 'x', text: 'y' })).rejects.toThrow('Resend respondeu 401');
  });
});
