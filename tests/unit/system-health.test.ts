import { describe, expect, it } from 'vitest';
import { evaluateSystemHealth } from '../../src/core/health/domain/index.js';

const NOW = new Date('2026-08-30T12:00:00.000Z');
const STALE_AFTER_MS = 180_000;

function baseInput() {
  return {
    dbStatus: 'ok' as const,
    lastSchedulerTickAt: NOW,
    whatsappState: 'open' as const,
    now: NOW,
    schedulerStaleAfterMs: STALE_AFTER_MS,
  };
}

describe('evaluateSystemHealth', () => {
  it('reporta saudável quando DB ok, scheduler com tick recente e sessão aberta', () => {
    const result = evaluateSystemHealth(baseInput());

    expect(result.healthy).toBe(true);
    expect(result.db).toBe('ok');
    expect(result.scheduler).toBe('ok');
    expect(result.whatsapp).toBe('ok');
  });

  it('degrada quando o DB está inacessível', () => {
    const result = evaluateSystemHealth({ ...baseInput(), dbStatus: 'error' });

    expect(result.healthy).toBe(false);
    expect(result.db).toBe('error');
  });

  it('degrada quando o scheduler não tem tick recente (fora da janela de tolerância)', () => {
    const staleTick = new Date(NOW.getTime() - STALE_AFTER_MS - 1_000);
    const result = evaluateSystemHealth({ ...baseInput(), lastSchedulerTickAt: staleTick });

    expect(result.healthy).toBe(false);
    expect(result.scheduler).toBe('stale');
  });

  it('não degrada quando o tick está dentro da janela de tolerância', () => {
    const recentTick = new Date(NOW.getTime() - STALE_AFTER_MS + 1_000);
    const result = evaluateSystemHealth({ ...baseInput(), lastSchedulerTickAt: recentTick });

    expect(result.healthy).toBe(true);
    expect(result.scheduler).toBe('ok');
  });

  it('trata scheduler sem tick nenhum ainda (boot) como saudável — grace period, não evidência de falha', () => {
    const result = evaluateSystemHealth({ ...baseInput(), lastSchedulerTickAt: undefined });

    expect(result.healthy).toBe(true);
    expect(result.scheduler).toBe('ok');
  });

  it.each(['close', 'connecting', 'qr_requested'] as const)(
    'degrada quando a sessão WhatsApp está em estado "%s"',
    (state) => {
      const result = evaluateSystemHealth({ ...baseInput(), whatsappState: state });

      expect(result.healthy).toBe(false);
      expect(result.whatsapp).toBe('degraded');
    },
  );

  it('trata sessão "unknown" (antes do primeiro connection.update) como saudável — grace period do boot', () => {
    const result = evaluateSystemHealth({ ...baseInput(), whatsappState: 'unknown' });

    expect(result.healthy).toBe(true);
    expect(result.whatsapp).toBe('ok');
  });

  it('todos os três saudáveis resulta em healthy=true (não-divergência com o /health)', () => {
    const result = evaluateSystemHealth(baseInput());
    expect(result.healthy).toBe(true);
  });
});
