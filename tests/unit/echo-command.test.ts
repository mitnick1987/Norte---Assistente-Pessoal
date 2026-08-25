import { describe, expect, it } from 'vitest';
import { pingCommand } from '../../src/modules/echo/command.js';

describe('pingCommand', () => {
  it('reconhece "ping" (case-insensitive, com espaços nas bordas)', () => {
    expect(pingCommand.match({ text: 'ping', ownerJid: 'x' })).toBe(true);
    expect(pingCommand.match({ text: 'PING', ownerJid: 'x' })).toBe(true);
    expect(pingCommand.match({ text: '  ping  ', ownerJid: 'x' })).toBe(true);
  });

  it('não reconhece texto que não seja exatamente "ping"', () => {
    expect(pingCommand.match({ text: 'ping pong', ownerJid: 'x' })).toBe(false);
    expect(pingCommand.match({ text: 'oi', ownerJid: 'x' })).toBe(false);
  });

  it('responde "pong" sem chamar nenhum LLM', async () => {
    const result = await pingCommand.handle({ text: 'ping', ownerJid: 'x' });
    expect(result.replyText).toBe('pong');
  });
});
