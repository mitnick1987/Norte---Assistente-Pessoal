import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { App } from '../../src/app.js';
import { buildTestApp } from '../factories/test-app.js';

const here = dirname(fileURLToPath(import.meta.url));
const expectedVersion = (JSON.parse(readFileSync(join(here, '../../package.json'), 'utf-8')) as { version: string })
  .version;

describe('GET /health', () => {
  let app: App;

  beforeEach(() => {
    app = buildTestApp();
  });

  afterEach(async () => {
    await app.fastify.close();
    app.db.close();
  });

  it('reporta db ok, versão do package.json (não npm_package_version) e estado inicial', async () => {
    const response = await app.fastify.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toMatchObject({
      status: 'ok',
      db: 'ok',
      whatsapp: { state: 'unknown' },
    });
    // regressão: versão não pode cair no fallback '0.0.0' quando o processo
    // roda sem passar por npm (é exatamente o caso do container de produção).
    expect(body.version).toBe(expectedVersion);
    expect(body.version).not.toBe('0.0.0');
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

  it('reporta degraded com HTTP 503 quando a sessão WhatsApp está fora do estado conectado (FEAT-008, fecha BUG-002)', async () => {
    await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': 'a'.repeat(32) },
      payload: { event: 'connection.update', instance: 'norte-test', data: { state: 'close' } },
    });

    const response = await app.fastify.inject({ method: 'GET', url: '/health' });
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(503);
    expect(body.status).toBe('degraded');
    expect(body.whatsapp.status).toBe('degraded');
  });

  it('reporta degraded com HTTP 503 quando o scheduler não tem tick recente, mesmo com DB e sessão ok', async () => {
    let now = new Date('2026-08-30T12:00:00.000Z');
    const staleApp = buildTestApp({}, { now: () => now });

    try {
      await staleApp.fastify.inject({
        method: 'POST',
        url: '/webhook/evolution',
        headers: { 'x-webhook-secret': 'a'.repeat(32) },
        payload: { event: 'connection.update', instance: 'norte-test', data: { state: 'open' } },
      });
      await staleApp.scheduler.tick(); // fixa lastSchedulerTickAt em `now` (T0)

      // avança o relógio além da janela de tolerância (default 180_000ms) sem rodar outro tick
      now = new Date(now.getTime() + 200_000);

      const response = await staleApp.fastify.inject({ method: 'GET', url: '/health' });
      const body = JSON.parse(response.body);

      expect(response.statusCode).toBe(503);
      expect(body.status).toBe('degraded');
      expect(body.scheduler.status).toBe('stale');
      expect(body.db).toBe('ok');
      expect(body.whatsapp.status).toBe('ok');
    } finally {
      await staleApp.fastify.close();
      staleApp.db.close();
    }
  });

  it('volta a 200/ok quando a sessão reconecta depois de ter caído', async () => {
    await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': 'a'.repeat(32) },
      payload: { event: 'connection.update', instance: 'norte-test', data: { state: 'close' } },
    });
    await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': 'a'.repeat(32) },
      payload: { event: 'connection.update', instance: 'norte-test', data: { state: 'open' } },
    });

    const response = await app.fastify.inject({ method: 'GET', url: '/health' });
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.status).toBe('ok');
  });
});
