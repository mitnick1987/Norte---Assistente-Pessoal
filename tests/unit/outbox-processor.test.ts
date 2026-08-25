import { describe, expect, it, vi } from 'vitest';
import { OutboxProcessor } from '../../src/core/outbox/processor.js';
import type { OutboxRepository, OutboxMessageRow } from '../../src/core/outbox/outbox-repository.js';
import type { MessageSender } from '../../src/core/outbox/sender.js';
import type { FailureAlerter } from '../../src/core/outbox/alerter.js';
import { MAX_ATTEMPTS } from '../../src/core/outbox/domain/backoff.js';

function buildRow(overrides: Partial<OutboxMessageRow>): OutboxMessageRow {
  return {
    id: 1,
    job_id: null,
    jid: '5511999999999@s.whatsapp.net',
    body: 'pong',
    is_proactive: 0,
    status: 'pending',
    attempts: 0,
    delivered_at: null,
    retry_after: null,
    ...overrides,
  };
}

function silentLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never;
}

function noSleep() {
  return async () => undefined;
}

describe('OutboxProcessor', () => {
  it('marca delivered_at somente após o sender confirmar envio (pós-2xx)', async () => {
    const row = buildRow({ id: 1 });
    const repository = {
      findPending: vi.fn().mockReturnValue([row]),
      markSending: vi.fn(),
      markDelivered: vi.fn(),
      countProactiveSentSince: vi.fn(),
    } as unknown as OutboxRepository;

    const sender: MessageSender = { sendText: vi.fn().mockResolvedValue(undefined), sendPresence: vi.fn() };
    const alerter: FailureAlerter = { alertDeliveryExhausted: vi.fn() };

    const processor = new OutboxProcessor({
      repository,
      sender,
      alerter,
      logger: silentLogger(),
      dailyProactiveCap: 6,
      now: () => new Date('2026-08-25T12:00:00.000Z'),
      sleep: noSleep(),
    });

    await processor.processPending();

    expect(sender.sendText).toHaveBeenCalledWith(row.jid, row.body);
    expect(repository.markDelivered).toHaveBeenCalledWith(1, new Date('2026-08-25T12:00:00.000Z'));
  });

  it('chama onDelivered somente após confirmação de envio, nunca em caso de falha', async () => {
    const row = buildRow({ id: 6 });
    const repository = {
      findPending: vi.fn().mockReturnValue([row]),
      markSending: vi.fn(),
      markDelivered: vi.fn(),
      countProactiveSentSince: vi.fn(),
    } as unknown as OutboxRepository;

    const sender: MessageSender = { sendText: vi.fn().mockResolvedValue(undefined), sendPresence: vi.fn() };
    const alerter: FailureAlerter = { alertDeliveryExhausted: vi.fn() };
    const onDelivered = vi.fn();

    const processor = new OutboxProcessor({
      repository,
      sender,
      alerter,
      logger: silentLogger(),
      dailyProactiveCap: 6,
      onDelivered,
      sleep: noSleep(),
    });

    await processor.processPending();

    expect(onDelivered).toHaveBeenCalledWith({ jid: row.jid, body: row.body });
  });

  it('nunca marca delivered_at quando o envio falha', async () => {
    const row = buildRow({ id: 2 });
    const repository = {
      findPending: vi.fn().mockReturnValue([row]),
      markSending: vi.fn(),
      markDelivered: vi.fn(),
      markPendingForRetry: vi.fn(),
      markFailed: vi.fn(),
      incrementAttempts: vi.fn(),
      countProactiveSentSince: vi.fn(),
    } as unknown as OutboxRepository;

    const sender: MessageSender = {
      sendText: vi.fn().mockRejectedValue(new Error('Evolution respondeu 500')),
      sendPresence: vi.fn(),
    };
    const alerter: FailureAlerter = { alertDeliveryExhausted: vi.fn() };

    const processor = new OutboxProcessor({
      repository,
      sender,
      alerter,
      logger: silentLogger(),
      dailyProactiveCap: 6,
      sleep: noSleep(),
    });

    await processor.processPending();

    expect(repository.markDelivered).not.toHaveBeenCalled();
    expect(repository.markPendingForRetry).toHaveBeenCalledTimes(1);
  });

  it('esgota o retry exponencial no teto de tentativas e aciona o alerta por e-mail', async () => {
    const row = buildRow({ id: 3, attempts: MAX_ATTEMPTS - 1 });
    const repository = {
      findPending: vi.fn().mockReturnValue([row]),
      markSending: vi.fn(),
      markFailed: vi.fn(),
      incrementAttempts: vi.fn(),
      countProactiveSentSince: vi.fn(),
    } as unknown as OutboxRepository;

    const sender: MessageSender = {
      sendText: vi.fn().mockRejectedValue(new Error('timeout')),
      sendPresence: vi.fn(),
    };
    const alerter: FailureAlerter = { alertDeliveryExhausted: vi.fn().mockResolvedValue(undefined) };

    const processor = new OutboxProcessor({
      repository,
      sender,
      alerter,
      logger: silentLogger(),
      dailyProactiveCap: 6,
      sleep: noSleep(),
    });

    await processor.processPending();

    expect(repository.markFailed).toHaveBeenCalledWith(3);
    expect(alerter.alertDeliveryExhausted).toHaveBeenCalledWith({ id: 3, jid: row.jid, attempts: MAX_ATTEMPTS });
  });

  it('aplica delay + sendPresence antes de mensagem proativa, mas não para mensagem reativa', async () => {
    const proactive = buildRow({ id: 4, is_proactive: 1 });
    const repository = {
      findPending: vi.fn().mockReturnValue([proactive]),
      markSending: vi.fn(),
      markDelivered: vi.fn(),
      countProactiveSentSince: vi.fn().mockReturnValue(0),
    } as unknown as OutboxRepository;

    const sender: MessageSender = { sendText: vi.fn().mockResolvedValue(undefined), sendPresence: vi.fn().mockResolvedValue(undefined) };
    const alerter: FailureAlerter = { alertDeliveryExhausted: vi.fn() };
    const sleep = vi.fn().mockResolvedValue(undefined);

    const processor = new OutboxProcessor({
      repository,
      sender,
      alerter,
      logger: silentLogger(),
      dailyProactiveCap: 6,
      sleep,
      random: () => 0.5,
    });

    await processor.processPending();

    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sender.sendPresence).toHaveBeenCalledWith(proactive.jid);
  });

  it('respeita o teto diário de proativas e represa a mensagem sem enviar', async () => {
    const proactive = buildRow({ id: 5, is_proactive: 1 });
    const repository = {
      findPending: vi.fn().mockReturnValue([proactive]),
      markSending: vi.fn(),
      countProactiveSentSince: vi.fn().mockReturnValue(6),
    } as unknown as OutboxRepository;

    const sender: MessageSender = { sendText: vi.fn(), sendPresence: vi.fn() };
    const alerter: FailureAlerter = { alertDeliveryExhausted: vi.fn() };

    const processor = new OutboxProcessor({
      repository,
      sender,
      alerter,
      logger: silentLogger(),
      dailyProactiveCap: 6,
      sleep: noSleep(),
    });

    await processor.processPending();

    expect(sender.sendText).not.toHaveBeenCalled();
    expect(repository.markSending).not.toHaveBeenCalled();
  });
});
