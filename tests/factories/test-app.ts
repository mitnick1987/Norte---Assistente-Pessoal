import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp, type App, type BuildAppOverrides } from '../../src/app.js';
import type { Env } from '../../src/core/env.js';

export type TestAppOverrides = Partial<Env>;

/**
 * Cada teste de integração recebe um arquivo SQLite temporário próprio —
 * nunca compartilha banco entre testes, nunca mocka o SQLite (TESTING.md §2).
 */
export function buildTestEnv(overrides: TestAppOverrides = {}): Env {
  const dir = mkdtempSync(join(tmpdir(), 'norte-test-'));
  return {
    NODE_ENV: 'test',
    HOST: '127.0.0.1',
    PORT: 0,
    DB_PATH: join(dir, 'norte.db'),
    TZ: 'America/Sao_Paulo',
    EVOLUTION_API_URL: 'http://evolution.test',
    EVOLUTION_API_KEY: 'test-evolution-api-key',
    EVOLUTION_INSTANCE: 'norte-test',
    EVOLUTION_WEBHOOK_SECRET: 'a'.repeat(32),
    BRAIN_WEBHOOK_URL: 'http://brain.test/webhook/evolution',
    OWNER_WHATSAPP_JID: '5511999999999@s.whatsapp.net',
    DAILY_PROACTIVE_CAP: 6,
    SMTP_URL: undefined,
    ALERT_EMAIL: undefined,
    ...overrides,
  };
}

/**
 * outboxSleep vira no-op por padrão — o delay anti-banimento real (10-45s)
 * é coberto por unit test de randomSendDelayMs; testes de integração não
 * podem depender de tempo real (CODE_STYLE §7). provisionWebhook desligado
 * por padrão: não há Evolution real para chamar em teste, e o fetch
 * stubado pelos próprios testes é para as chamadas do outbox, não para o
 * provisionamento (testado isoladamente em webhook-provisioner.test.ts).
 */
export function buildTestApp(overrides: TestAppOverrides = {}, appOverrides: BuildAppOverrides = {}): App {
  return buildApp(buildTestEnv(overrides), {
    outboxSleep: async () => undefined,
    provisionWebhook: false,
    ...appOverrides,
  });
}
