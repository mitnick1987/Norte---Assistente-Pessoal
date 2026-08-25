import { pino } from 'pino';
import type { Logger } from 'pino';

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
  'req.headers.apikey',
  'req.headers["x-webhook-secret"]',
  'webhookSecret',
  '*.webhookSecret',
  'AUTHENTICATION_API_KEY',
  'EVOLUTION_API_KEY',
  'EVOLUTION_WEBHOOK_SECRET',
  'TOKEN_ENCRYPTION_KEY',
  'refreshToken',
  '*.refreshToken',
  'refresh_token',
  '*.refresh_token',
];

export function createLogger(nodeEnv: string): Logger {
  const base = {
    level: nodeEnv === 'test' ? ('silent' as const) : ('info' as const),
    redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
  };

  if (nodeEnv === 'development') {
    return pino({ ...base, transport: { target: 'pino-pretty' } });
  }
  return pino(base);
}
