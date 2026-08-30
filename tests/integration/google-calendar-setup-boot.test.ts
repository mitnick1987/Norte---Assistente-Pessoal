import { randomBytes } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { App } from '../../src/app.js';
import { buildTestApp } from '../factories/test-app.js';

describe('boot condicional do módulo google-calendar (spec item 5, FEAT-005)', () => {
  let app: App;

  afterEach(async () => {
    await app.fastify.close();
    app.db.close();
  });

  it('sem as 4 credenciais do Google, o processo sobe normalmente e as rotas de setup não existem (404)', async () => {
    app = buildTestApp();

    const health = await app.fastify.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);

    const setup = await app.fastify.inject({ method: 'GET', url: '/setup/google' });
    expect(setup.statusCode).toBe(404);
  });

  it('com as 4 credenciais configuradas, a migração auth_tokens roda e a rota de setup responde', async () => {
    app = buildTestApp({
      GOOGLE_CLIENT_ID: 'client-id-teste',
      GOOGLE_CLIENT_SECRET: 'client-secret-teste',
      GOOGLE_REDIRECT_URI: 'http://localhost:3000/setup/google/callback',
      TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    });

    const tables = app.db
      .prepare<[], { name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table'`)
      .all()
      .map((r) => r.name);
    expect(tables).toContain('auth_tokens');

    const setup = await app.fastify.inject({ method: 'GET', url: '/setup/google' });
    expect(setup.statusCode).toBe(302);
    expect(setup.headers.location).toContain('client-id-teste');
  });
});
