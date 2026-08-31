import { describe, expect, it, vi } from 'vitest';
import { ConnectionWatchdog } from '../../src/core/channel/whatsapp-evolution/connection-watchdog.js';

describe('ConnectionWatchdog', () => {
  it('registra o estado observado e o timestamp', () => {
    const watchdog = new ConnectionWatchdog();
    const now = new Date('2026-08-30T12:00:00.000Z');

    watchdog.observe('open', now);

    expect(watchdog.getState()).toEqual({ state: 'open', lastUpdatedAt: now });
  });

  it('estado inicial é "unknown" antes de qualquer observação', () => {
    const watchdog = new ConnectionWatchdog();
    expect(watchdog.getState().state).toBe('unknown');
  });

  it('estado bruto desconhecido normaliza para "unknown"', () => {
    const watchdog = new ConnectionWatchdog();
    watchdog.observe('algum-estado-novo-da-evolution');
    expect(watchdog.getState().state).toBe('unknown');
  });

  it('observeQrRequested transiciona para "qr_requested"', () => {
    const watchdog = new ConnectionWatchdog();
    watchdog.observeQrRequested();
    expect(watchdog.getState().state).toBe('qr_requested');
  });

  describe('onStateChange (FEAT-008, watchdog -> alerta)', () => {
    it('dispara o callback quando o estado muda (conectado -> caído)', () => {
      const onStateChange = vi.fn();
      const watchdog = new ConnectionWatchdog({ onStateChange });

      watchdog.observe('open');
      watchdog.observe('close');

      expect(onStateChange).toHaveBeenCalledTimes(2);
      expect(onStateChange).toHaveBeenNthCalledWith(1, 'open');
      expect(onStateChange).toHaveBeenNthCalledWith(2, 'close');
    });

    it('não dispara o callback quando o estado observado é o mesmo do anterior (evita alerta repetido)', () => {
      const onStateChange = vi.fn();
      const watchdog = new ConnectionWatchdog({ onStateChange });

      watchdog.observe('close');
      onStateChange.mockClear();
      watchdog.observe('close');
      watchdog.observe('close');

      expect(onStateChange).not.toHaveBeenCalled();
    });

    it('dispara o callback para pedido de novo QR (observeQrRequested)', () => {
      const onStateChange = vi.fn();
      const watchdog = new ConnectionWatchdog({ onStateChange });

      watchdog.observeQrRequested();

      expect(onStateChange).toHaveBeenCalledWith('qr_requested');
    });

    it('sem callback configurado, observe/observeQrRequested não lançam', () => {
      const watchdog = new ConnectionWatchdog();
      expect(() => watchdog.observe('close')).not.toThrow();
      expect(() => watchdog.observeQrRequested()).not.toThrow();
    });
  });
});
