/**
 * `qr_requested` não vem do payload de `connection.update` — é sintetizado
 * pelo webhook a partir do evento `qrcode.updated` (FEAT-008, spec item 3:
 * "pedido de novo QR dispara e-mail com instrução de re-scan", mesmo
 * caminho da sessão caída).
 */
export type ConnectionState = 'open' | 'connecting' | 'close' | 'qr_requested' | 'unknown';

function toConnectionState(rawState: string): ConnectionState {
  if (rawState === 'open' || rawState === 'connecting' || rawState === 'close') return rawState;
  return 'unknown';
}

export interface ConnectionWatchdogDeps {
  /**
   * Chamado só quando o estado observado difere do anterior (FEAT-008,
   * spec item 3) — nunca a cada `connection.update` bruto, senão uma
   * sequência de eventos no mesmo estado (a Evolution reemite bastante)
   * dispararia alerta repetido antes mesmo do anti-flood entrar em ação.
   * Callback em vez de importar `infra-ops` direto: `core/channel` não pode
   * depender de infra-ops (ARCHITECTURE.md §2, boundaries).
   */
  onStateChange?: (state: ConnectionState) => void;
}

/**
 * Estado da sessão WhatsApp em memória, exposto pelo /health. Notifica
 * mudança de estado via callback (FEAT-008) — o alerta de fato (e-mail,
 * anti-flood) é decidido por quem injeta o callback, nunca aqui.
 */
export class ConnectionWatchdog {
  private state: ConnectionState = 'unknown';
  private lastUpdatedAt: Date | undefined;

  constructor(private readonly deps: ConnectionWatchdogDeps = {}) {}

  observe(rawState: string, now: Date = new Date()): void {
    this.setState(toConnectionState(rawState), now);
  }

  /** `qrcode.updated` (Evolution) não carrega `state` — é um evento próprio, tratado como transição para `qr_requested`. */
  observeQrRequested(now: Date = new Date()): void {
    this.setState('qr_requested', now);
  }

  private setState(next: ConnectionState, now: Date): void {
    const changed = next !== this.state;
    this.state = next;
    this.lastUpdatedAt = now;

    if (changed) this.deps.onStateChange?.(next);
  }

  getState(): { state: ConnectionState; lastUpdatedAt: Date | undefined } {
    return { state: this.state, lastUpdatedAt: this.lastUpdatedAt };
  }
}
