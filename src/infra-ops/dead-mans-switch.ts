import type { Logger } from 'pino';
import { evaluateSystemHealth, type SystemHealthInput } from '../core/health/index.js';

export interface DeadMansSwitchDeps {
  readonly pingUrl: string | undefined;
  readonly getHealthInput: () => Omit<SystemHealthInput, 'now'>;
  readonly logger: Logger;
  now?: () => Date;
}

/**
 * Ping ao Healthchecks.io (RF-13, spec item 2) — só sai quando os
 * subsistemas essenciais estão de fato saudáveis (mesma função de avaliação
 * do `/health`, Decisões tomadas): pingar "vivo" com o scheduler parado ou a
 * sessão caída anularia o propósito do dead man's switch. Se o processo
 * inteiro cai, o ping simplesmente para de chegar — o próprio Healthchecks.io
 * detecta a ausência e alerta, sem depender de nada aqui dentro.
 */
export async function pingDeadMansSwitch(deps: DeadMansSwitchDeps): Promise<void> {
  if (!deps.pingUrl) return;

  const now = deps.now ? deps.now() : new Date();
  const health = evaluateSystemHealth({ ...deps.getHealthInput(), now });

  if (!health.healthy) {
    deps.logger.warn({ health }, 'dead man\'s switch: ping suprimido, sistema não está saudável');
    return;
  }

  try {
    const response = await fetch(deps.pingUrl, { method: 'GET' });
    if (!response.ok) {
      deps.logger.warn({ status: response.status }, 'dead man\'s switch: ping respondeu com erro');
    }
  } catch (err) {
    // Falha de rede ao pingar não é falha do produto — é o próprio
    // Healthchecks.io que vai perceber a ausência e alertar (spec item 2).
    // Nunca propaga: um ping falho não pode derrubar o job do scheduler.
    const message = err instanceof Error ? err.message : 'erro desconhecido';
    deps.logger.warn({ message }, 'dead man\'s switch: falha ao pingar Healthchecks.io');
  }
}
