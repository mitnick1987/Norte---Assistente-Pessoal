import { afterEach, describe, expect, it, vi } from 'vitest';

const sendMailMock = vi.fn();
const createTransportMock = vi.fn((_url: string) => ({ sendMail: sendMailMock }));

vi.mock('nodemailer', () => ({
  default: { createTransport: (url: string) => createTransportMock(url) },
}));

afterEach(() => {
  sendMailMock.mockReset();
  createTransportMock.mockClear();
});

describe('buildMailer', () => {
  it('SMTP_URL configurada tem prioridade sobre RESEND_API_KEY (SmtpMailer)', async () => {
    const { buildMailer } = await import('../../src/infra-ops/build-mailer.js');
    const { SmtpMailer } = await import('../../src/infra-ops/mailer.js');

    const mailer = buildMailer({
      smtpUrl: 'smtps://user:pass@smtp.test:465',
      resendApiKey: 'resend-key',
      alertEmailFrom: 'alertas@dono.com',
      alertEmail: 'dono@example.com',
    });

    expect(mailer).toBeInstanceOf(SmtpMailer);
  });

  it('sem SMTP_URL, usa ResendMailer quando RESEND_API_KEY está configurada', async () => {
    const { buildMailer } = await import('../../src/infra-ops/build-mailer.js');
    const { ResendMailer } = await import('../../src/infra-ops/mailer.js');

    const mailer = buildMailer({
      smtpUrl: undefined,
      resendApiKey: 'resend-key',
      alertEmailFrom: undefined,
      alertEmail: undefined,
    });

    expect(mailer).toBeInstanceOf(ResendMailer);
  });

  it('sem nenhum transporte configurado, retorna undefined', async () => {
    const { buildMailer } = await import('../../src/infra-ops/build-mailer.js');

    const mailer = buildMailer({
      smtpUrl: undefined,
      resendApiKey: undefined,
      alertEmailFrom: undefined,
      alertEmail: undefined,
    });

    expect(mailer).toBeUndefined();
  });

  it('SmtpMailer usa ALERT_EMAIL_FROM quando fornecida', async () => {
    sendMailMock.mockResolvedValueOnce(undefined);
    const { buildMailer } = await import('../../src/infra-ops/build-mailer.js');

    const mailer = buildMailer({
      smtpUrl: 'smtps://user:pass@smtp.test:465',
      resendApiKey: undefined,
      alertEmailFrom: 'alertas@dono-verificado.com',
      alertEmail: 'dono@example.com',
    });
    await mailer!.send({ to: 'x@example.com', subject: 's', text: 't' });

    expect(sendMailMock).toHaveBeenCalledWith(expect.objectContaining({ from: 'alertas@dono-verificado.com' }));
  });

  it('SmtpMailer sem ALERT_EMAIL_FROM cai para ALERT_EMAIL (último recurso, nunca resend.dev)', async () => {
    sendMailMock.mockResolvedValueOnce(undefined);
    const { buildMailer } = await import('../../src/infra-ops/build-mailer.js');

    const mailer = buildMailer({
      smtpUrl: 'smtps://smtp.test:465', // sem usuário embutido na URL
      resendApiKey: undefined,
      alertEmailFrom: undefined,
      alertEmail: 'dono@example.com',
    });
    await mailer!.send({ to: 'x@example.com', subject: 's', text: 't' });

    const call = sendMailMock.mock.calls[0]![0] as { from: string };
    expect(call.from).toBe('dono@example.com');
    expect(call.from).not.toContain('resend.dev');
  });
});
