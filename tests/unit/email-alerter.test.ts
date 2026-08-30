import { describe, expect, it, vi } from 'vitest';
import { EmailAlerter } from '../../src/infra-ops/email-alerter.js';

function silentLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never;
}

describe('EmailAlerter', () => {
  it('loga em error mesmo sem transporte de e-mail configurado (nunca falha em silêncio)', async () => {
    const logger = silentLogger() as { error: ReturnType<typeof vi.fn> };
    const alerter = new EmailAlerter({ smtpUrl: undefined, alertEmail: undefined }, logger as never);

    await alerter.alertDeliveryExhausted({ id: 1, jid: 'x', attempts: 5 });

    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('loga em error quando o transporte está configurado, sem incluir o e-mail do dono (PII) no payload', async () => {
    const logger = silentLogger() as { error: ReturnType<typeof vi.fn> };
    const alerter = new EmailAlerter(
      { smtpUrl: 'smtp://localhost:1025', alertEmail: 'dono@example.com' },
      logger as never,
    );

    await alerter.alertDeliveryExhausted({ id: 2, jid: 'y', attempts: 5 });

    expect(logger.error).toHaveBeenCalledTimes(1);
    const [payload] = logger.error.mock.calls[0] as [Record<string, unknown>];
    expect(payload['message']).toEqual({ id: 2, jid: 'y', attempts: 5 });
    expect(payload['alertEmail']).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain('dono@example.com');
  });

  it('loga falha de refresh OAuth em error mesmo sem transporte configurado (nunca falha em silêncio)', async () => {
    const logger = silentLogger() as { error: ReturnType<typeof vi.fn> };
    const alerter = new EmailAlerter({ smtpUrl: undefined, alertEmail: undefined }, logger as never);

    await alerter.alertRefreshFailure({ provider: 'google_calendar', err: new Error('invalid_grant') });

    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('loga falha de refresh OAuth só com provider e mensagem, nunca o erro bruto (pode carregar corpo de resposta com segredo)', async () => {
    const logger = silentLogger() as { error: ReturnType<typeof vi.fn> };
    const alerter = new EmailAlerter(
      { smtpUrl: 'smtp://localhost:1025', alertEmail: 'dono@example.com' },
      logger as never,
    );

    await alerter.alertRefreshFailure({ provider: 'google_calendar', err: new Error('invalid_grant') });

    expect(logger.error).toHaveBeenCalledTimes(1);
    const [payload] = logger.error.mock.calls[0] as [Record<string, unknown>];
    expect(payload).toEqual({ provider: 'google_calendar', message: 'invalid_grant' });
  });

  it('loga ritual-âncora represado pelo teto em error mesmo sem transporte configurado (nunca falha em silêncio)', async () => {
    const logger = silentLogger() as { error: ReturnType<typeof vi.fn> };
    const alerter = new EmailAlerter({ smtpUrl: undefined, alertEmail: undefined }, logger as never);

    await alerter.alertAnchorRitualCapped({ id: 42, jid: '5511999999999@s.whatsapp.net' });

    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('loga ritual-âncora represado com o id/jid da mensagem quando o transporte está configurado', async () => {
    const logger = silentLogger() as { error: ReturnType<typeof vi.fn> };
    const alerter = new EmailAlerter(
      { smtpUrl: 'smtp://localhost:1025', alertEmail: 'dono@example.com' },
      logger as never,
    );

    await alerter.alertAnchorRitualCapped({ id: 42, jid: '5511999999999@s.whatsapp.net' });

    expect(logger.error).toHaveBeenCalledTimes(1);
    const [payload] = logger.error.mock.calls[0] as [Record<string, unknown>];
    expect(payload['message']).toEqual({ id: 42, jid: '5511999999999@s.whatsapp.net' });
    expect(JSON.stringify(payload)).not.toContain('dono@example.com');
  });
});
