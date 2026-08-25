import { describe, expect, it, vi } from 'vitest';
import { provisionEvolutionWebhook } from '../../src/core/channel/whatsapp-evolution/webhook-provisioner.js';
import { jsonResponse } from '../factories/fetch-stub.js';

function silentLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never;
}

function baseConfig() {
  return {
    evolutionApiUrl: 'http://evolution:8080',
    evolutionApiKey: 'evolution-api-key',
    instance: 'norte',
    webhookUrl: 'http://brain:3000/webhook/evolution',
    webhookSecret: 'a'.repeat(32),
  };
}

describe('provisionEvolutionWebhook', () => {
  it('chama webhook/set com a URL do brain, o segredo na query string e os eventos exigidos', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { webhook: {} }));
    const logger = silentLogger() as { info: ReturnType<typeof vi.fn> };

    await provisionEvolutionWebhook(baseConfig(), logger as never, { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://evolution:8080/webhook/set/norte');
    expect((init.headers as Record<string, string>)['apikey']).toBe('evolution-api-key');

    const body = JSON.parse(init.body as string) as {
      webhook: { url: string; events: string[]; enabled: boolean };
    };
    expect(body.webhook.enabled).toBe(true);
    expect(body.webhook.url).toBe(`http://brain:3000/webhook/evolution?secret=${'a'.repeat(32)}`);
    expect(body.webhook.events).toEqual(
      expect.arrayContaining(['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'QRCODE_UPDATED']),
    );

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ instance: 'norte' }),
      'webhook da Evolution provisionado com sucesso',
    );
  });

  it('tenta de novo com backoff quando a Evolution ainda não responde, e conclui ao suceder', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(jsonResponse(200));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const logger = silentLogger() as { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> };

    await provisionEvolutionWebhook(baseConfig(), logger as never, { fetchImpl, sleep, baseDelayMs: 100 });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenCalledTimes(1);
  });

  it('loga falha clara em error quando esgota as tentativas sem sucesso, sem derrubar o boot', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('timeout'));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const logger = silentLogger() as { error: ReturnType<typeof vi.fn> };

    await expect(
      provisionEvolutionWebhook(baseConfig(), logger as never, { fetchImpl, sleep, maxAttempts: 3, baseDelayMs: 10 }),
    ).resolves.toBeUndefined();

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('trata resposta não-2xx da Evolution como falha e tenta novamente', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(500, { error: 'internal' }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const logger = silentLogger() as { error: ReturnType<typeof vi.fn> };

    await provisionEvolutionWebhook(baseConfig(), logger as never, { fetchImpl, sleep, maxAttempts: 2, baseDelayMs: 10 });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});
