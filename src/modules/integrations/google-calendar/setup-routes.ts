import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { InvalidOAuthStateError, type GoogleCalendarService } from './google-calendar-service.js';

const callbackQuerySchema = z.object({ code: z.string().min(1), state: z.string().min(1).optional() }).passthrough();

/**
 * Rotas administrativas de setup único (spec item 1, impacto técnico):
 * fora do webhook público, sem filtro de JID (não fazem parte do canal
 * WhatsApp) — operação local de uma vez só (ADR-013), nunca de uso diário.
 * A superfície é fechada no `infra/Caddyfile`, que expõe publicamente só
 * `/webhook/evolution*` e `/health` e devolve 404 para qualquer outro path
 * — o registro Fastify em si não impõe essa restrição, então o Caddyfile é
 * quem garante que `/setup/*` só responde a quem chega direto na porta
 * local (túnel SSH) durante o setup manual do dono. Sem sessão própria: a
 * validação anti-CSRF/injeção de código vem do `state` de uso único que o
 * `GoogleCalendarService` gera em `buildConsentUrl` e confere aqui no
 * callback (ver `isValidState` em google-calendar-service.ts).
 */
export function registerGoogleCalendarSetupRoutes(app: FastifyInstance, service: GoogleCalendarService): void {
  app.get('/setup/google', async (_request, reply) => {
    const url = service.buildConsentUrl();
    return reply.redirect(url);
  });

  app.get('/setup/google/callback', async (request, reply) => {
    const parsed = callbackQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'parâmetro "code" ausente ou inválido' });
    }

    try {
      await service.completeSetup(parsed.data.code, parsed.data.state);
    } catch (err) {
      if (err instanceof InvalidOAuthStateError) {
        request.log.warn('callback OAuth do Google Calendar rejeitado: state ausente ou inválido');
        return reply.status(400).send({ error: 'state ausente ou inválido — refaça o setup a partir de GET /setup/google' });
      }
      request.log.error({ err }, 'falha ao completar o setup OAuth do Google Calendar');
      return reply.status(502).send({ error: 'falha ao trocar o código por tokens — veja o log do servidor' });
    }

    return reply.send({ status: 'ok', message: 'Google Calendar autorizado com sucesso.' });
  });
}
