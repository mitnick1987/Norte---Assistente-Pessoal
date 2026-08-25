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

  it('loga em error quando o transporte está configurado', async () => {
    const logger = silentLogger() as { error: ReturnType<typeof vi.fn> };
    const alerter = new EmailAlerter(
      { smtpUrl: 'smtp://localhost:1025', alertEmail: 'dono@example.com' },
      logger as never,
    );

    await alerter.alertDeliveryExhausted({ id: 2, jid: 'y', attempts: 5 });

    expect(logger.error).toHaveBeenCalledTimes(1);
    const [payload] = logger.error.mock.calls[0] as [Record<string, unknown>];
    expect(payload['alertEmail']).toBe('dono@example.com');
  });
});
