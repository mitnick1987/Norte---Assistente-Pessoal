import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { registerGoogleCalendarSetupRoutes } from '../../src/modules/integrations/google-calendar/setup-routes.js';
import type { GoogleCalendarService } from '../../src/modules/integrations/google-calendar/google-calendar-service.js';

function buildApp(serviceOverrides: Partial<GoogleCalendarService> = {}) {
  const app = Fastify({ logger: false });
  const service = {
    buildConsentUrl: vi.fn(() => 'https://accounts.google.com/o/oauth2/v2/auth?scope=calendar.events'),
    completeSetup: vi.fn().mockResolvedValue(undefined),
    ...serviceOverrides,
  } as unknown as GoogleCalendarService;

  registerGoogleCalendarSetupRoutes(app, service);
  return { app, service };
}

describe('GET /setup/google', () => {
  it('redireciona para a URL de consent gerada pelo serviço', async () => {
    const { app } = buildApp();

    const response = await app.inject({ method: 'GET', url: '/setup/google' });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('https://accounts.google.com/o/oauth2/v2/auth?scope=calendar.events');
  });
});

describe('GET /setup/google/callback', () => {
  it('troca o code por tokens e devolve sucesso', async () => {
    const { app, service } = buildApp();

    const response = await app.inject({ method: 'GET', url: '/setup/google/callback?code=abc123' });

    expect(response.statusCode).toBe(200);
    expect(service.completeSetup).toHaveBeenCalledWith('abc123');
    expect(response.json()).toEqual({ status: 'ok', message: expect.any(String) });
  });

  it('rejeita chamada sem "code" antes de tentar completar o setup', async () => {
    const { app, service } = buildApp();

    const response = await app.inject({ method: 'GET', url: '/setup/google/callback' });

    expect(response.statusCode).toBe(400);
    expect(service.completeSetup).not.toHaveBeenCalled();
  });

  it('falha da troca de tokens vira 502 com mensagem sem detalhe sensível, nunca 200 mascarando erro', async () => {
    const { app } = buildApp({ completeSetup: vi.fn().mockRejectedValue(new Error('invalid_grant')) });

    const response = await app.inject({ method: 'GET', url: '/setup/google/callback?code=abc123' });

    expect(response.statusCode).toBe(502);
    expect(response.json().error).not.toContain('invalid_grant');
  });
});
