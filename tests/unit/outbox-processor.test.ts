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
    is_anchor_ritual: 0,
    status: 'pending',
    attempts: 0,
    delivered_at: null,
    retry_after: null,
    ...overrides,
  };
}

function buildAlerter(overrides: Partial<FailureAlerter> = {}): FailureAlerter {
  return {
    alertDeliveryExhausted: vi.fn(),
    alertRefreshFailure: vi.fn(),
    alertAnchorRitualCapped: vi.fn(),
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
      claimForSending: vi.fn().mockReturnValue(true),
      markDelivered: vi.fn(),
      countProactiveSentSince: vi.fn(),
    } as unknown as OutboxRepository;

    const sender: MessageSender = { sendText: vi.fn().mockResolvedValue(undefined), sendPresence: vi.fn() };
    const alerter: FailureAlerter = buildAlerter();

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
      claimForSending: vi.fn().mockReturnValue(true),
      markDelivered: vi.fn(),
      countProactiveSentSince: vi.fn(),
    } as unknown as OutboxRepository;

    const sender: MessageSender = { sendText: vi.fn().mockResolvedValue(undefined), sendPresence: vi.fn() };
    const alerter: FailureAlerter = buildAlerter();
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

    expect(onDelivered).toHaveBeenCalledWith({ jid: row.jid, body: row.body, isProactive: false });
  });

  it('onDelivered recebe isProactive=true para mensagem de job (briefing/revisão/lembrete)', async () => {
    const row = buildRow({ id: 7, is_proactive: 1 });
    const repository = {
      findPending: vi.fn().mockReturnValue([row]),
      claimForSending: vi.fn().mockReturnValue(true),
      markDelivered: vi.fn(),
      countProactiveSentSince: vi.fn().mockReturnValue(0),
    } as unknown as OutboxRepository;

    const sender: MessageSender = {
      sendText: vi.fn().mockResolvedValue(undefined),
      sendPresence: vi.fn().mockResolvedValue(undefined),
    };
    const alerter: FailureAlerter = buildAlerter();
    const onDelivered = vi.fn();

    const processor = new OutboxProcessor({
      repository,
      sender,
      alerter,
      logger: silentLogger(),
      dailyProactiveCap: 6,
      onDelivered,
      sleep: noSleep(),
      random: () => 0,
    });

    await processor.processPending();

    expect(onDelivered).toHaveBeenCalledWith({ jid: row.jid, body: row.body, isProactive: true });
  });

  it('nunca marca delivered_at quando o envio falha', async () => {
    const row = buildRow({ id: 2 });
    const repository = {
      findPending: vi.fn().mockReturnValue([row]),
      claimForSending: vi.fn().mockReturnValue(true),
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
    const alerter: FailureAlerter = buildAlerter();

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
      claimForSending: vi.fn().mockReturnValue(true),
      markFailed: vi.fn(),
      incrementAttempts: vi.fn(),
      countProactiveSentSince: vi.fn(),
    } as unknown as OutboxRepository;

    const sender: MessageSender = {
      sendText: vi.fn().mockRejectedValue(new Error('timeout')),
      sendPresence: vi.fn(),
    };
    const alerter: FailureAlerter = buildAlerter({ alertDeliveryExhausted: vi.fn().mockResolvedValue(undefined) });

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
      claimForSending: vi.fn().mockReturnValue(true),
      markDelivered: vi.fn(),
      countProactiveSentSince: vi.fn().mockReturnValue(0),
    } as unknown as OutboxRepository;

    const sender: MessageSender = { sendText: vi.fn().mockResolvedValue(undefined), sendPresence: vi.fn().mockResolvedValue(undefined) };
    const alerter: FailureAlerter = buildAlerter();
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
      claimForSending: vi.fn().mockReturnValue(true),
      countProactiveSentSince: vi.fn().mockReturnValue(6),
    } as unknown as OutboxRepository;

    const sender: MessageSender = { sendText: vi.fn(), sendPresence: vi.fn() };
    const alerter: FailureAlerter = buildAlerter();

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
    expect(repository.claimForSending).not.toHaveBeenCalled();
  });

  it('teto continua limite duro para ritual-âncora (não isenta), mas dispara alerta explícito em vez de só logar (achado de review FEAT-006)', async () => {
    const briefing = buildRow({ id: 10, is_proactive: 1, is_anchor_ritual: 1 });
    const repository = {
      findPending: vi.fn().mockReturnValue([briefing]),
      claimForSending: vi.fn().mockReturnValue(true),
      countProactiveSentSince: vi.fn().mockReturnValue(6),
    } as unknown as OutboxRepository;

    const sender: MessageSender = { sendText: vi.fn(), sendPresence: vi.fn() };
    const alerter: FailureAlerter = buildAlerter();

    const processor = new OutboxProcessor({
      repository,
      sender,
      alerter,
      logger: silentLogger(),
      dailyProactiveCap: 6,
      sleep: noSleep(),
    });

    await processor.processPending();

    // teto ainda barra o envio — ritual-âncora não pula a checagem.
    expect(sender.sendText).not.toHaveBeenCalled();
    expect(repository.claimForSending).not.toHaveBeenCalled();
    // mas a supressão nunca é silenciosa: alerta dedicado dispara.
    expect(alerter.alertAnchorRitualCapped).toHaveBeenCalledWith({ id: 10, jid: briefing.jid });
  });

  it('proativa comum represada pelo teto não dispara o alerta de ritual-âncora', async () => {
    const proactive = buildRow({ id: 11, is_proactive: 1, is_anchor_ritual: 0 });
    const repository = {
      findPending: vi.fn().mockReturnValue([proactive]),
      claimForSending: vi.fn().mockReturnValue(true),
      countProactiveSentSince: vi.fn().mockReturnValue(6),
    } as unknown as OutboxRepository;

    const sender: MessageSender = { sendText: vi.fn(), sendPresence: vi.fn() };
    const alerter: FailureAlerter = buildAlerter();

    const processor = new OutboxProcessor({
      repository,
      sender,
      alerter,
      logger: silentLogger(),
      dailyProactiveCap: 6,
      sleep: noSleep(),
    });

    await processor.processPending();

    expect(alerter.alertAnchorRitualCapped).not.toHaveBeenCalled();
  });

  it('conta o teto diário a partir da meia-noite de America/Sao_Paulo, não de uma janela rolante de 24h', async () => {
    const proactive = buildRow({ id: 7, is_proactive: 1 });
    const repository = {
      findPending: vi.fn().mockReturnValue([proactive]),
      claimForSending: vi.fn().mockReturnValue(true),
      markDelivered: vi.fn(),
      countProactiveSentSince: vi.fn().mockReturnValue(0),
    } as unknown as OutboxRepository;

    const sender: MessageSender = { sendText: vi.fn().mockResolvedValue(undefined), sendPresence: vi.fn().mockResolvedValue(undefined) };
    const alerter: FailureAlerter = buildAlerter();

    // 00:30 em São Paulo (UTC-03:00) em 26/08 == 03:30 UTC do mesmo dia.
    const processor = new OutboxProcessor({
      repository,
      sender,
      alerter,
      logger: silentLogger(),
      dailyProactiveCap: 6,
      now: () => new Date('2026-08-26T03:30:00.000Z'),
      sleep: noSleep(),
      random: () => 0.5,
    });

    await processor.processPending();

    // meia-noite de 26/08 em São Paulo == 2026-08-26T03:00:00.000Z — se a
    // janela ainda fosse rolante de 24h, o "since" cairia no dia anterior.
    expect(repository.countProactiveSentSince).toHaveBeenCalledWith('2026-08-26T03:00:00.000Z');
  });

  it('duas execuções concorrentes de processPending enviam a mensagem só 1 vez (guard de reentrância)', async () => {
    const row = buildRow({ id: 8 });
    // simula o sleep cedendo o event loop no meio do processamento — é
    // exatamente a janela em que um segundo tick concorrente entraria.
    let releaseFirstRun: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      releaseFirstRun = resolve;
    });

    const repository = {
      findPending: vi.fn().mockReturnValue([row]),
      claimForSending: vi.fn().mockReturnValue(true),
      markDelivered: vi.fn(),
      countProactiveSentSince: vi.fn(),
    } as unknown as OutboxRepository;

    const sender: MessageSender = {
      sendText: vi.fn().mockImplementation(async () => {
        await blocked;
      }),
      sendPresence: vi.fn(),
    };
    const alerter: FailureAlerter = buildAlerter();

    const processor = new OutboxProcessor({
      repository,
      sender,
      alerter,
      logger: silentLogger(),
      dailyProactiveCap: 6,
      sleep: noSleep(),
    });

    const firstRun = processor.processPending();
    const secondRun = processor.processPending();

    releaseFirstRun!();
    await Promise.all([firstRun, secondRun]);

    expect(sender.sendText).toHaveBeenCalledTimes(1);
    expect(repository.findPending).toHaveBeenCalledTimes(1);
  });

  it('não reenvia mensagem cujo claim atômico já foi perdido para outra execução', async () => {
    const row = buildRow({ id: 9 });
    const repository = {
      findPending: vi.fn().mockReturnValue([row]),
      claimForSending: vi.fn().mockReturnValue(false),
      markDelivered: vi.fn(),
      countProactiveSentSince: vi.fn(),
    } as unknown as OutboxRepository;

    const sender: MessageSender = { sendText: vi.fn().mockResolvedValue(undefined), sendPresence: vi.fn() };
    const alerter: FailureAlerter = buildAlerter();

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
    expect(repository.markDelivered).not.toHaveBeenCalled();
  });
});
