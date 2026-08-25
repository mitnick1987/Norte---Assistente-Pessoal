import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { App } from '../../src/app.js';
import { buildTestApp } from '../factories/test-app.js';

describe('GET /health', () => {
  let app: App;

  beforeEach(() => {
    app = buildTestApp();
  });

  afterEach(async () => {
    await app.fastify.close();
    app.db.close();
  });

  it('reporta db ok, versão e estado inicial (sem sessão WhatsApp conectada ainda)', async () => {
    const response = await app.fastify.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toMatchObject({
      status: 'ok',
      db: 'ok',
      whatsapp: { state: 'unknown' },
    });
    expect(body.version).toBeTruthy();
  });

  it('reflete o estado da sessão WhatsApp após um connection.update', async () => {
    await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': 'a'.repeat(32) },
      payload: { event: 'connection.update', instance: 'norte-test', data: { state: 'open' } },
    });

    const response = await app.fastify.inject({ method: 'GET', url: '/health' });
    const body = JSON.parse(response.body);

    expect(body.whatsapp.state).toBe('open');
  });

  it('reflete o último tick do scheduler depois de rodar', async () => {
    await app.scheduler.tick();

    const response = await app.fastify.inject({ method: 'GET', url: '/health' });
    const body = JSON.parse(response.body);

    expect(body.scheduler.lastTickAt).not.toBeNull();
  });
});
