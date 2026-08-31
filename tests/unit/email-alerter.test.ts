import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../../src/core/db/migrator.js';
import { infraOpsMigrations } from '../../src/infra-ops/migrations/index.js';
import { EmailAlerter } from '../../src/infra-ops/email-alerter.js';
import { AlertDispatchRepository } from '../../src/infra-ops/alert-dispatch-repository.js';
import type { Mailer, MailMessage } from '../../src/infra-ops/mailer.js';

function silentLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never;
}

function buildDb() {
  const db = new Database(':memory:');
  runMigrations(db, infraOpsMigrations);
  return db;
}

function buildMailerStub(impl?: (message: MailMessage) => Promise<void>): { mailer: Mailer; sent: MailMessage[] } {
  const sent: MailMessage[] = [];
  const mailer: Mailer = {
    send: vi.fn(async (message: MailMessage) => {
      sent.push(message);
      if (impl) await impl(message);
    }),
  };
  return { mailer, sent };
}

const ANTI_FLOOD_WINDOW_MS = 30 * 60_000;

function buildAlerter(opts: {
  mailer?: Mailer;
  alertEmail?: string | undefined;
  logger?: { error: ReturnType<typeof vi.fn> };
  now?: () => Date;
}) {
  const db = buildDb();
  const dispatchRepository = new AlertDispatchRepository(db);
  const logger = opts.logger ?? (silentLogger() as { error: ReturnType<typeof vi.fn> });
  const alertEmail = 'alertEmail' in opts ? opts.alertEmail : 'dono@example.com';
  const alerter = new EmailAlerter(
    { alertEmail, getAntiFloodWindowMs: () => ANTI_FLOOD_WINDOW_MS },
    opts.mailer,
    dispatchRepository,
    logger as never,
    opts.now ?? (() => new Date('2026-08-30T10:00:00.000Z')),
  );
  return { alerter, db, logger };
}

describe('EmailAlerter — sem transporte configurado', () => {
  it('loga em error mesmo sem transporte de e-mail configurado (nunca falha em silêncio)', async () => {
    const { alerter, logger } = buildAlerter({});

    await alerter.alertDeliveryExhausted({ id: 1, jid: 'x', attempts: 5 });

    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('loga em error quando alertEmail está ausente mesmo com mailer configurado', async () => {
    const { mailer } = buildMailerStub();
    const { alerter, logger } = buildAlerter({ mailer, alertEmail: undefined });

    await alerter.alertDeliveryExhausted({ id: 1, jid: 'x', attempts: 5 });

    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(mailer.send).not.toHaveBeenCalled();
  });
});

describe('EmailAlerter — envio real', () => {
  it('envia e-mail de verdade quando o transporte está configurado', async () => {
    const { mailer, sent } = buildMailerStub();
    const { alerter, logger } = buildAlerter({ mailer });

    await alerter.alertDeliveryExhausted({ id: 2, jid: 'y', attempts: 5 });

    expect(mailer.send).toHaveBeenCalledTimes(1);
    expect(sent[0]?.to).toBe('dono@example.com');
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('falha de envio cai em log error, sem incluir segredo/e-mail do dono no payload', async () => {
    const { mailer } = buildMailerStub(async () => {
      throw new Error('SMTP indisponível');
    });
    const { alerter, logger } = buildAlerter({ mailer });

    await alerter.alertDeliveryExhausted({ id: 3, jid: 'z', attempts: 5 });

    expect(logger.error).toHaveBeenCalledTimes(1);
    const [payload] = logger.error.mock.calls[0] as [Record<string, unknown>];
    expect(JSON.stringify(payload)).not.toContain('dono@example.com');
  });

  it('alertAnchorRitualCapped envia e-mail real quando ritual-âncora é represado pelo teto diário', async () => {
    const { mailer, sent } = buildMailerStub();
    const { alerter, logger } = buildAlerter({ mailer });

    await alerter.alertAnchorRitualCapped({ id: 7, jid: '5511999999999@s.whatsapp.net' });

    expect(mailer.send).toHaveBeenCalledTimes(1);
    expect(sent[0]?.subject).toMatch(/teto diário/i);
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('alertRefreshFailure nunca loga o erro bruto, só provider e mensagem', async () => {
    const { mailer } = buildMailerStub(async () => {
      throw new Error('falha de rede');
    });
    const { alerter, logger } = buildAlerter({ mailer });

    await alerter.alertRefreshFailure({ provider: 'google_calendar', err: new Error('invalid_grant') });

    expect(logger.error).toHaveBeenCalledTimes(1);
    const [payload] = logger.error.mock.calls[0] as [Record<string, unknown>];
    expect(payload['message']).toBe('falha de rede');
  });
});

describe('EmailAlerter — anti-flood', () => {
  it('não reenvia a mesma chave dentro da janela', async () => {
    let now = new Date('2026-08-30T10:00:00.000Z');
    const { mailer } = buildMailerStub();
    const { alerter } = buildAlerter({ mailer, now: () => now });

    await alerter.alertDeliveryExhausted({ id: 42, jid: 'x', attempts: 5 });
    now = new Date(now.getTime() + 60_000); // 1 min depois, dentro da janela de 30 min
    await alerter.alertDeliveryExhausted({ id: 42, jid: 'x', attempts: 6 });

    expect(mailer.send).toHaveBeenCalledTimes(1);
  });

  it('volta a permitir envio depois que a janela expira', async () => {
    let now = new Date('2026-08-30T10:00:00.000Z');
    const { mailer } = buildMailerStub();
    const { alerter } = buildAlerter({ mailer, now: () => now });

    await alerter.alertDeliveryExhausted({ id: 42, jid: 'x', attempts: 5 });
    now = new Date(now.getTime() + ANTI_FLOOD_WINDOW_MS + 1_000);
    await alerter.alertDeliveryExhausted({ id: 42, jid: 'x', attempts: 6 });

    expect(mailer.send).toHaveBeenCalledTimes(2);
  });

  it('chaves lógicas diferentes não competem pela mesma cota (sessão caída não bloqueia alerta de disco)', async () => {
    const { mailer } = buildMailerStub();
    const { alerter } = buildAlerter({ mailer });

    await alerter.alertSessionDown({ state: 'close' });
    await alerter.alertDiskUsage({ usagePercent: 90, thresholdPercent: 85 });

    expect(mailer.send).toHaveBeenCalledTimes(2);
  });

  it('alertCostBudgetExceeded e alertCacheRegression usam chaves lógicas próprias', async () => {
    const { mailer } = buildMailerStub();
    const { alerter } = buildAlerter({ mailer });

    await alerter.alertCostBudgetExceeded({ projectedMonthlyCostUsd: 30, budgetUsd: 25 });
    await alerter.alertCacheRegression();

    expect(mailer.send).toHaveBeenCalledTimes(2);
  });

  /**
   * Achado de review FEAT-008: o anti-flood era check-then-act (lê
   * "fora da janela", só grava depois do `await mailer.send`) — dois
   * disparos concorrentes do MESMO alerta liam o estado antes de qualquer
   * um gravar, e os dois enviavam. `Promise.all` aqui simula o cenário real
   * (dois eventos que disparam o mesmo `alertKey` quase ao mesmo tempo,
   * ex. dois retries esgotando quase juntos); com o claim atômico
   * (AlertDispatchRepository.tryClaim), só uma das duas chamadas envia.
   */
  it('dois disparos concorrentes da mesma chave — só um envio (claim atômico sob concorrência)', async () => {
    const { mailer } = buildMailerStub();
    const { alerter } = buildAlerter({ mailer });

    await Promise.all([
      alerter.alertDeliveryExhausted({ id: 99, jid: 'x', attempts: 5 }),
      alerter.alertDeliveryExhausted({ id: 99, jid: 'x', attempts: 5 }),
    ]);

    expect(mailer.send).toHaveBeenCalledTimes(1);
  });
});
