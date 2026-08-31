import { statfs } from 'node:fs/promises';
import type { Logger } from 'pino';
import type { FailureAlerter } from '../core/outbox/alerter.js';
import { diskUsageExceeded, diskUsagePercent } from './domain/disk-usage.js';

export interface DiskMonitorDeps {
  readonly path: string;
  readonly thresholdPercent: number;
  readonly alerter: FailureAlerter;
  readonly logger: Logger;
}

/**
 * Best-effort (spec item 6, Decisões tomadas): `fs.statfs` expõe o
 * filesystem montado sem dependência nova, mas alguns ambientes (containers
 * com certas configurações de storage driver) podem não suportar a syscall —
 * falha aqui nunca derruba o processo, só loga e segue.
 */
export async function checkDiskUsage(deps: DiskMonitorDeps): Promise<void> {
  try {
    const stats = await statfs(deps.path);
    const totalBytes = stats.blocks * stats.bsize;
    // bavail (não bfree): bfree inclui blocos reservados ao root, que um
    // processo sem privilégio nunca consegue de fato usar — bavail é o que
    // sobra disponível para o usuário que roda o processo (glossário POSIX
    // statvfs), o número que importa para prever "vai faltar espaço".
    const freeBytes = stats.bavail * stats.bsize;
    const usagePercent = diskUsagePercent(totalBytes, freeBytes);

    if (diskUsageExceeded(usagePercent, deps.thresholdPercent)) {
      await deps.alerter.alertDiskUsage({ usagePercent, thresholdPercent: deps.thresholdPercent });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'erro desconhecido';
    deps.logger.warn({ message }, 'falha ao checar uso de disco (best-effort, seguindo sem alerta)');
  }
}
