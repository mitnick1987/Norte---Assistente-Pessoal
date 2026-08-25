export type ConnectionState = 'open' | 'connecting' | 'close' | 'unknown';

function toConnectionState(rawState: string): ConnectionState {
  if (rawState === 'open' || rawState === 'connecting' || rawState === 'close') return rawState;
  return 'unknown';
}

/**
 * Estado da sessão WhatsApp em memória, exposto pelo /health. Watchdog
 * "básico" nesta fundação: só registra o último estado observado; alerta
 * por e-mail em sessão caída fica para quando infra-ops estiver plugado
 * (a spec já prevê o registro como pré-requisito).
 */
export class ConnectionWatchdog {
  private state: ConnectionState = 'unknown';
  private lastUpdatedAt: Date | undefined;

  observe(rawState: string, now: Date = new Date()): void {
    this.state = toConnectionState(rawState);
    this.lastUpdatedAt = now;
  }

  getState(): { state: ConnectionState; lastUpdatedAt: Date | undefined } {
    return { state: this.state, lastUpdatedAt: this.lastUpdatedAt };
  }
}
