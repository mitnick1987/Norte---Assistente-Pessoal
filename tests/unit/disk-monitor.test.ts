import { describe, expect, it, vi } from 'vitest';
import { checkDiskUsage } from '../../src/infra-ops/disk-monitor.js';
import { buildAlerterStub } from '../factories/alerter-stub.js';

vi.mock('node:fs/promises', () => ({
  statfs: vi.fn(),
}));

function silentLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never;
}

describe('checkDiskUsage', () => {
  it('dispara alerta quando o uso passa do limiar', async () => {
    const { statfs } = await import('node:fs/promises');
    vi.mocked(statfs).mockResolvedValue({ blocks: 100, bfree: 5, bsize: 1 } as never);

    const alerter = buildAlerterStub();
    await checkDiskUsage({ path: '/data', thresholdPercent: 85, alerter, logger: silentLogger() });

    expect(alerter.alertDiskUsage).toHaveBeenCalledWith({ usagePercent: 95, thresholdPercent: 85 });
  });

  it('não dispara alerta quando o uso está abaixo do limiar', async () => {
    const { statfs } = await import('node:fs/promises');
    vi.mocked(statfs).mockResolvedValue({ blocks: 100, bfree: 50, bsize: 1 } as never);

    const alerter = buildAlerterStub();
    await checkDiskUsage({ path: '/data', thresholdPercent: 85, alerter, logger: silentLogger() });

    expect(alerter.alertDiskUsage).not.toHaveBeenCalled();
  });

  it('falha ao checar disco (best-effort) não derruba o processo, loga e segue sem alertar', async () => {
    const { statfs } = await import('node:fs/promises');
    vi.mocked(statfs).mockRejectedValue(new Error('ENOSYS'));

    const alerter = buildAlerterStub();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    await expect(
      checkDiskUsage({ path: '/data', thresholdPercent: 85, alerter, logger: logger as never }),
    ).resolves.toBeUndefined();

    expect(alerter.alertDiskUsage).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});
