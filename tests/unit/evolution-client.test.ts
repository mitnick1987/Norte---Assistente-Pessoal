import { afterEach, describe, expect, it, vi } from 'vitest';
import { EvolutionClient } from '../../src/core/channel/whatsapp-evolution/evolution-client.js';
import { SendFailedError } from '../../src/core/outbox/sender.js';
import { jsonResponse, stubFetch } from '../factories/fetch-stub.js';

function buildClient(): EvolutionClient {
  return new EvolutionClient({
    baseUrl: 'http://evolution.test',
    apiKey: 'test-key',
    instance: 'norte-test',
  });
}

describe('EvolutionClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sendText faz POST ao endpoint correto com jid e corpo', async () => {
    const { calls } = stubFetch(() => jsonResponse(200, { status: 'success' }));
    const client = buildClient();

    await client.sendText('jid-1', 'pong');

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('http://evolution.test/message/sendText/norte-test');
    expect(JSON.parse(calls[0]!.init!.body as string)).toEqual({ number: 'jid-1', text: 'pong' });
  });

  it('sendText lança SendFailedError quando a Evolution não responde 2xx', async () => {
    stubFetch(() => jsonResponse(500));
    const client = buildClient();

    await expect(client.sendText('jid-1', 'pong')).rejects.toBeInstanceOf(SendFailedError);
  });

  it('sendPresence faz POST ao endpoint de presença', async () => {
    const { calls } = stubFetch(() => jsonResponse(200));
    const client = buildClient();

    await client.sendPresence('jid-1');

    expect(calls[0]?.url).toBe('http://evolution.test/chat/sendPresence/norte-test');
  });

  it('getBase64FromMediaMessage busca ativamente a mídia, nunca confia em base64 do payload', async () => {
    const { calls } = stubFetch(() => jsonResponse(200, { base64: 'AAAA' }));
    const client = buildClient();

    const base64 = await client.getBase64FromMediaMessage({ id: 'msg-1' });

    expect(base64).toBe('AAAA');
    expect(calls[0]?.url).toBe('http://evolution.test/chat/getBase64FromMediaMessage/norte-test');
  });

  it('getBase64FromMediaMessage lança erro quando a resposta não traz base64', async () => {
    stubFetch(() => jsonResponse(200, {}));
    const client = buildClient();

    await expect(client.getBase64FromMediaMessage({ id: 'msg-1' })).rejects.toThrow(/base64/);
  });
});
