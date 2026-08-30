import { pino } from 'pino';
import type { Logger } from 'pino';
import type { Writable } from 'node:stream';

/**
 * Redação obrigatória (SECURITY.md §4): nenhum secret aparece em log, nem
 * em debug. Os paths cobrem tanto objetos de config quanto payloads de
 * request/headers que eventualmente carreguem os mesmos nomes de campo.
 */
const REDACTED_PATHS = [
  'apiKey',
  '*.apiKey',
  'apikey',
  '*.apikey',
  'headers.apikey',
  'headers["x-webhook-secret"]',
  'headers["x-api-key"]',
  'headers.authorization',
  'headers.Authorization',
  'req.headers.apikey',
  'req.headers["x-webhook-secret"]',
  'req.headers["x-api-key"]',
  'req.headers.authorization',
  'req.headers.Authorization',
  'webhookSecret',
  '*.webhookSecret',
  'AUTHENTICATION_API_KEY',
  'EVOLUTION_API_KEY',
  'EVOLUTION_WEBHOOK_SECRET',
  'TOKEN_ENCRYPTION_KEY',
  'ANTHROPIC_API_KEY',
  'GROQ_API_KEY',
  'OPENAI_API_KEY',
  'GOOGLE_CLIENT_SECRET',
  'RESEND_API_KEY',
  'SMTP_URL',
  'ALERT_EMAIL',
  'refreshToken',
  '*.refreshToken',
  'refresh_token',
  '*.refresh_token',
  'accessToken',
  '*.accessToken',
  'access_token',
  '*.access_token',
  'accessTokenEncrypted',
  '*.accessTokenEncrypted',
  'refreshTokenEncrypted',
  '*.refreshTokenEncrypted',
];

/**
 * O fallback de segredo do webhook via query string (`?secret=...`, ver
 * webhook-provisioner.ts) chega inteiro em `req.url` — os `paths` de redact
 * do pino não enxergam dentro de uma URL como string, só objetos. Sem isso
 * o próprio log de acesso do Fastify vazaria o segredo em toda requisição
 * bem-sucedida do webhook.
 */
function stripQueryString(url: string): string {
  const questionMarkIndex = url.indexOf('?');
  return questionMarkIndex === -1 ? url : url.slice(0, questionMarkIndex);
}

/** destination injetável só para teste do serializer sem depender de captura de stdout real. */
export function createLogger(nodeEnv: string, destination?: Writable): Logger {
  const base = {
    level: nodeEnv === 'test' ? ('silent' as const) : ('info' as const),
    redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
    serializers: {
      req(request: { method: string; url: string; id: unknown }) {
        return { method: request.method, url: stripQueryString(request.url), id: request.id };
      },
    },
  };

  if (destination) {
    return pino(base, destination);
  }
  if (nodeEnv === 'development') {
    return pino({ ...base, transport: { target: 'pino-pretty' } });
  }
  return pino(base);
}
