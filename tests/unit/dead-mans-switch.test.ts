import { describe, expect, it, vi } from 'vitest';
import { pingDeadMansSwitch } from '../../src/infra-ops/dead-mans-switch.js';
import { jsonResponse, stubFetch } from '../factories/fetch-stub.js';

const NOW = new Date('2026-08-30T12:00:00.000Z');
const PING_URL = 'https://hc-ping.com/test-uuid';

function silentLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never;
}

function healthyInput() {
  return {
    dbStatus: 'ok' as const,
    lastSchedulerTickAt: NOW,
    whatsappState: 'open' as const,
    schedulerStaleAfterMs: 180_000,
  };
}

describe('pingDeadMansSwitch — gate de saúde (mesma função de /health, não-divergência)', () => {
  it('pinga quando DB ok + scheduler com tick recente + sessão conectada', async () => {
    const { calls } = stubFetch(() => jsonResponse(200, {}));

    await pingDeadMansSwitch({
      pingUrl: PING_URL,
      getHealthInput: healthyInput,
      logger: silentLogger(),
      now: () => NOW,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(PING_URL);
  });

  it('não pinga quando o DB está inacessível', async () => {
    const { calls } = stubFetch(() => jsonResponse(200, {}));

    await pingDeadMansSwitch({
      pingUrl: PING_URL,
      getHealthInput: () => ({ ...healthyInput(), dbStatus: 'error' }),
      logger: silentLogger(),
      now: () => NOW,
    });

    expect(calls).toHaveLength(0);
  });

  it('não pinga quando o scheduler não tem tick recente', async () => {
    const { calls } = stubFetch(() => jsonResponse(200, {}));

    await pingDeadMansSwitch({
      pingUrl: PING_URL,
      getHealthInput: () => ({ ...healthyInput(), lastSchedulerTickAt: new Date('2026-08-30T00:00:00.000Z') }),
      logger: silentLogger(),
      now: () => NOW,
    });

    expect(calls).toHaveLength(0);
  });

  it('não pinga quando a sessão WhatsApp não está conectada', async () => {
    const { calls } = stubFetch(() => jsonResponse(200, {}));

    await pingDeadMansSwitch({
      pingUrl: PING_URL,
      getHealthInput: () => ({ ...healthyInput(), whatsappState: 'close' }),
      logger: silentLogger(),
      now: () => NOW,
    });

    expect(calls).toHaveLength(0);
  });

  it('sem HEALTHCHECKS_PING_URL configurado, nunca tenta pingar (desliga sem derrubar o processo)', async () => {
    const { calls } = stubFetch(() => jsonResponse(200, {}));

    await pingDeadMansSwitch({
      pingUrl: undefined,
      getHealthInput: healthyInput,
      logger: silentLogger(),
      now: () => NOW,
    });

    expect(calls).toHaveLength(0);
  });

  it('falha de rede ao pingar nunca propaga — só loga warn e segue', async () => {
    stubFetch(() => {
      throw new Error('ECONNREFUSED');
    });
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    await expect(
      pingDeadMansSwitch({
        pingUrl: PING_URL,
        getHealthInput: healthyInput,
        logger: logger as never,
        now: () => NOW,
      }),
    ).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});
