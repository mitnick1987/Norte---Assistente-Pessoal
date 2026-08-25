import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp, type App } from '../../src/app.js';
import { buildTestEnv } from '../factories/test-app.js';
import { jsonResponse, stubFetch } from '../factories/fetch-stub.js';

describe('autoprovisionamento do webhook da Evolution no boot', () => {
  let app: App | undefined;

  afterEach(async () => {
    if (app) {
      await app.stop();
    }
    vi.unstubAllGlobals();
  });

  it('chama webhook/set da Evolution com a URL do brain e o segredo assim que o processo sobe', async () => {
    const env = buildTestEnv({ PORT: 0 });
    const { calls } = stubFetch(() => jsonResponse(200, { webhook: {} }));

    app = buildApp(env, { outboxSleep: async () => undefined, provisionWebhook: true });
    await app.start();

    // provisionamento é fire-and-forget para não atrasar o listen — dá um
    // tick para a promise resolver antes de checar as chamadas.
    await new Promise((resolve) => setTimeout(resolve, 10));

    const provisionCall = calls.find((c) => c.url.includes('/webhook/set/'));
    expect(provisionCall).toBeDefined();
    expect(provisionCall!.url).toBe(`${env.EVOLUTION_API_URL}/webhook/set/${env.EVOLUTION_INSTANCE}`);

    const body = JSON.parse(provisionCall!.init!.body as string) as { webhook: { url: string } };
    expect(body.webhook.url).toContain(`secret=${env.EVOLUTION_WEBHOOK_SECRET}`);
  });

  it('não chama a Evolution quando provisionWebhook está desligado (padrão de teste)', async () => {
    const env = buildTestEnv({ PORT: 0 });
    const { calls } = stubFetch(() => jsonResponse(200, { webhook: {} }));

    app = buildApp(env, { outboxSleep: async () => undefined, provisionWebhook: false });
    await app.start();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(calls.some((c) => c.url.includes('/webhook/set/'))).toBe(false);
  });
});
