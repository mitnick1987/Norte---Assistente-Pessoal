import { describe, expect, it } from 'vitest';
import { shouldSendAlert } from '../../src/infra-ops/domain/anti-flood.js';

const WINDOW_MS = 30 * 60_000;
const NOW = new Date('2026-08-30T12:00:00.000Z');

describe('shouldSendAlert', () => {
  it('permite envio quando nunca houve disparo anterior', () => {
    expect(shouldSendAlert(undefined, NOW, WINDOW_MS)).toBe(true);
  });

  it('bloqueia dentro da janela desde o último disparo', () => {
    const lastSentAt = new Date(NOW.getTime() - 1_000);
    expect(shouldSendAlert(lastSentAt, NOW, WINDOW_MS)).toBe(false);
  });

  it('permite exatamente no limite da janela', () => {
    const lastSentAt = new Date(NOW.getTime() - WINDOW_MS);
    expect(shouldSendAlert(lastSentAt, NOW, WINDOW_MS)).toBe(true);
  });

  it('permite depois que a janela expira', () => {
    const lastSentAt = new Date(NOW.getTime() - WINDOW_MS - 1_000);
    expect(shouldSendAlert(lastSentAt, NOW, WINDOW_MS)).toBe(true);
  });
});
