import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { GoogleCalendarService } from './google-calendar-service.js';

const callbackQuerySchema = z.object({ code: z.string().min(1) }).passthrough();

/**
 * Rotas administrativas de setup único (spec item 1, impacto técnico):
 * fora do webhook público, sem filtro de JID (não fazem parte do canal
 * WhatsApp) — a superfície fica protegida por nunca serem publicadas atrás
 * do Caddy (infra/Caddyfile só expõe `/webhook` e `/health`, SECURITY.md
 * §5), acessíveis só localmente ou por túnel SSH durante o setup manual do
 * dono. Não é tela de uso diário: sem sessão, sem estado entre as duas
 * chamadas além do que o próprio fluxo OAuth do Google carrega no `code`.
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
      await service.completeSetup(parsed.data.code);
    } catch (err) {
      request.log.error({ err }, 'falha ao completar o setup OAuth do Google Calendar');
      return reply.status(502).send({ error: 'falha ao trocar o código por tokens — veja o log do servidor' });
    }

    return reply.send({ status: 'ok', message: 'Google Calendar autorizado com sucesso.' });
  });
}
