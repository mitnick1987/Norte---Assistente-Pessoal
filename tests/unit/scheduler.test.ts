import { describe, expect, it, vi } from 'vitest';
import type { Logger } from 'pino';
import { Scheduler } from '../../src/core/scheduler/scheduler.js';
import type { JobHandler } from '../../src/core/kernel/types.js';
import type { JobRepository, JobRow } from '../../src/core/scheduler/job-repository.js';

function buildRow(overrides: Partial<JobRow>): JobRow {
  return {
    id: 1,
    type: 'reminder',
    payload: '{}',
    next_run_at: '2026-08-25T11:00:00.000Z',
    recurrence: null,
    status: 'pending',
    attempts: 0,
    delivered_at: null,
    ...overrides,
  };
}

function silentLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never;
}

describe('Scheduler', () => {
  it('dispara jobs vencidos encontrados durante o catch-up do boot', async () => {
    const row = buildRow({ id: 42 });
    const repository = {
      findPending: vi.fn().mockReturnValue([row]),
      findById: vi.fn().mockReturnValue(row),
      markRunning: vi.fn(),
      rescheduleRecurring: vi.fn(),
      incrementAttempts: vi.fn(),
    } as unknown as JobRepository;

    const handler = vi.fn<JobHandler>().mockResolvedValue(undefined);
    const scheduler = new Scheduler({
      repository,
      jobHandlers: new Map([['reminder', handler]]),
      logger: silentLogger(),
      now: () => new Date('2026-08-25T12:00:00.000Z'),
    });

    await scheduler.runCatchUp();

    expect(handler).toHaveBeenCalledWith({ jobId: 42, payload: {} });
    expect(repository.markRunning).toHaveBeenCalledWith(42);
  });

  it('não dispara job com delivered_at preenchido, mesmo que apareça na lista de pending', async () => {
    const row = buildRow({ id: 7, delivered_at: '2026-08-25T11:05:00.000Z' });
    const repository = {
      findPending: vi.fn().mockReturnValue([row]),
      findById: vi.fn(),
      markRunning: vi.fn(),
    } as unknown as JobRepository;

    const handler = vi.fn<JobHandler>();
    const scheduler = new Scheduler({
      repository,
      jobHandlers: new Map([['reminder', handler]]),
      logger: silentLogger(),
      now: () => new Date('2026-08-25T12:00:00.000Z'),
    });

    await scheduler.tick();

    expect(handler).not.toHaveBeenCalled();
    expect(repository.markRunning).not.toHaveBeenCalled();
  });

  it('reagenda a próxima ocorrência somente no momento do disparo, para job recorrente', async () => {
    const row = buildRow({ id: 5, recurrence: 'daily' });
    const repository = {
      findPending: vi.fn().mockReturnValue([row]),
      findById: vi.fn().mockReturnValue(row),
      markRunning: vi.fn(),
      rescheduleRecurring: vi.fn(),
    } as unknown as JobRepository;

    const handler = vi.fn<JobHandler>().mockResolvedValue(undefined);
    const fireInstant = new Date('2026-08-25T12:00:00.000Z');
    const scheduler = new Scheduler({
      repository,
      jobHandlers: new Map([['reminder', handler]]),
      logger: silentLogger(),
      now: () => fireInstant,
    });

    await scheduler.tick();

    expect(repository.rescheduleRecurring).toHaveBeenCalledTimes(1);
    const [jobId, nextRunAt] = (repository.rescheduleRecurring as ReturnType<typeof vi.fn>).mock.calls[0] as [
      number,
      Date,
    ];
    expect(jobId).toBe(5);
    expect(nextRunAt.getTime()).toBeGreaterThan(fireInstant.getTime());
  });

  it('loga e não quebra quando não há handler registrado para o tipo do job', async () => {
    const row = buildRow({ id: 9, type: 'tipo-desconhecido' });
    const repository = {
      findPending: vi.fn().mockReturnValue([row]),
      findById: vi.fn().mockReturnValue(row),
      markRunning: vi.fn(),
    } as unknown as JobRepository;

    const logger = silentLogger();
    const scheduler = new Scheduler({
      repository,
      jobHandlers: new Map(),
      logger,
      now: () => new Date('2026-08-25T12:00:00.000Z'),
    });

    await expect(scheduler.tick()).resolves.toBeUndefined();
    expect(repository.markRunning).not.toHaveBeenCalled();
  });

  it('incrementa attempts e propaga o erro quando o handler falha (job não recorrente)', async () => {
    const row = buildRow({ id: 3 });
    const repository = {
      findPending: vi.fn().mockReturnValue([row]),
      findById: vi.fn().mockReturnValue(row),
      markRunning: vi.fn(),
      incrementAttempts: vi.fn(),
    } as unknown as JobRepository;

    const handler = vi.fn<JobHandler>().mockRejectedValue(new Error('falha no handler'));
    const logger = silentLogger();
    const scheduler = new Scheduler({
      repository,
      jobHandlers: new Map([['reminder', handler]]),
      logger,
      now: () => new Date('2026-08-25T12:00:00.000Z'),
    });

    await expect(scheduler.tick()).rejects.toThrow('falha no handler');
    expect(repository.incrementAttempts).toHaveBeenCalledWith(3);
  });

  /**
   * Regressão do achado de review: sem este comportamento, uma exceção do
   * handler de 'cobranca' (ou qualquer job `every`) deixava o job preso em
   * 'running' pra sempre — `findPending` só vê 'pending', então a
   * recorrência inteira parava até um restart (ADR-004: job durável não pode
   * depender de restart pra continuar funcionando).
   */
  it('job recorrente que falha reagenda a próxima ocorrência mesmo assim — a recorrência nunca para por uma exceção isolada', async () => {
    const row = buildRow({ id: 8, type: 'cobranca', recurrence: JSON.stringify({ kind: 'every', minutes: 60 }) });
    const repository = {
      findPending: vi.fn().mockReturnValue([row]),
      findById: vi.fn().mockReturnValue(row),
      markRunning: vi.fn(),
      rescheduleRecurring: vi.fn(),
      incrementAttempts: vi.fn(),
    } as unknown as JobRepository;

    const handler = vi.fn<JobHandler>().mockRejectedValue(new Error('SQLITE_BUSY'));
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
    const fireInstant = new Date('2026-08-25T12:00:00.000Z');
    const scheduler = new Scheduler({
      repository,
      jobHandlers: new Map([['cobranca', handler]]),
      logger,
      now: () => fireInstant,
    });

    // não deve propagar — o tick engole o erro do job recorrente para poder
    // seguir reagendando (o log de erro já registra a falha).
    await expect(scheduler.tick()).resolves.toBeUndefined();

    expect(repository.incrementAttempts).toHaveBeenCalledWith(8);
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ jobId: 8 }), expect.any(String));
    expect(repository.rescheduleRecurring).toHaveBeenCalledTimes(1);
    const [jobId, nextRunAt] = (repository.rescheduleRecurring as ReturnType<typeof vi.fn>).mock.calls[0] as [number, Date];
    expect(jobId).toBe(8);
    expect(nextRunAt.getTime()).toBeGreaterThan(fireInstant.getTime());
  });

  it('job recorrente que falha não fica preso em running: a linha nunca segue tentando lançar de novo no mesmo tick', async () => {
    const row = buildRow({ id: 11, type: 'cobranca', recurrence: 'daily' });
    let handlerCalls = 0;
    const repository = {
      findPending: vi.fn().mockReturnValue([row]),
      findById: vi.fn().mockReturnValue(row),
      markRunning: vi.fn(),
      rescheduleRecurring: vi.fn(),
      incrementAttempts: vi.fn(),
    } as unknown as JobRepository;

    const handler = vi.fn<JobHandler>().mockImplementation(async () => {
      handlerCalls += 1;
      throw new Error('falha transitória');
    });
    const scheduler = new Scheduler({
      repository,
      jobHandlers: new Map([['cobranca', handler]]),
      logger: silentLogger(),
      now: () => new Date('2026-08-25T12:00:00.000Z'),
    });

    await scheduler.tick();

    expect(handlerCalls).toBe(1);
    expect(repository.rescheduleRecurring).toHaveBeenCalledTimes(1);
  });

  it('start agenda ticks periódicos e stop interrompe o polling', async () => {
    vi.useFakeTimers();
    try {
      const repository = {
        findPending: vi.fn().mockReturnValue([]),
      } as unknown as JobRepository;

      const scheduler = new Scheduler({
        repository,
        jobHandlers: new Map(),
        logger: silentLogger(),
      });

      scheduler.start();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(repository.findPending).toHaveBeenCalledTimes(1);

      scheduler.stop();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(repository.findPending).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('getLastTickAt reflete o instante do último tick executado', async () => {
    const repository = { findPending: vi.fn().mockReturnValue([]) } as unknown as JobRepository;
    const fixedNow = new Date('2026-08-25T12:00:00.000Z');
    const scheduler = new Scheduler({ repository, jobHandlers: new Map(), logger: silentLogger(), now: () => fixedNow });

    expect(scheduler.getLastTickAt()).toBeUndefined();
    await scheduler.tick();
    expect(scheduler.getLastTickAt()).toEqual(fixedNow);
  });
});
