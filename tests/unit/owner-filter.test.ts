import { describe, expect, it } from 'vitest';
import { isFromOwner, normalizeJid } from '../../src/core/channel/whatsapp-evolution/owner-filter.js';

describe('isFromOwner', () => {
  it('aceita mensagem do JID exatamente igual ao configurado', () => {
    expect(isFromOwner('5511999999999@s.whatsapp.net', '5511999999999@s.whatsapp.net')).toBe(true);
  });

  it('rejeita mensagem de JID diferente', () => {
    expect(isFromOwner('5511888888888@s.whatsapp.net', '5511999999999@s.whatsapp.net')).toBe(false);
  });

  it('ignora sufixo de dispositivo (:12) ao comparar', () => {
    expect(isFromOwner('5511999999999:12@s.whatsapp.net', '5511999999999@s.whatsapp.net')).toBe(true);
  });
});

describe('normalizeJid', () => {
  it('remove sufixo de dispositivo quando presente', () => {
    expect(normalizeJid('5511999999999:5@s.whatsapp.net')).toBe('5511999999999@s.whatsapp.net');
  });

  it('mantém JID inalterado quando não há sufixo', () => {
    expect(normalizeJid('5511999999999@s.whatsapp.net')).toBe('5511999999999@s.whatsapp.net');
  });
});
