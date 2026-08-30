import type { Migration } from '../../../../core/kernel/types.js';

/**
 * `auth_tokens` é `provider`-keyed (spec, Decisões tomadas): cada integração
 * OAuth futura (Gmail RF-22, contas Claude/OpenAI RF-33) grava sua própria
 * linha com sua própria migração — este módulo só é dono da migração que
 * cria a tabela pela primeira vez, não de linhas de outros providers.
 *
 * `access_token_encrypted`/`refresh_token_encrypted` nunca em texto plano
 * (SECURITY.md §4, AES-256-GCM via token-cipher.ts). `expiry`/`updated_at`
 * em UTC (ISO 8601) — TZ America/Sao_Paulo só entra no cálculo de exibição,
 * nunca no armazenamento (CODE_STYLE §2).
 */
export const googleCalendarAuthTokens001: Migration = {
  id: 'integrations_google_calendar_001_auth_tokens',
  up(db) {
    db.exec(`
      CREATE TABLE auth_tokens (
        provider TEXT PRIMARY KEY,
        access_token_encrypted TEXT NOT NULL,
        refresh_token_encrypted TEXT NOT NULL,
        expiry TEXT NOT NULL,
        scopes TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  },
  down(db) {
    db.exec('DROP TABLE IF EXISTS auth_tokens;');
  },
};
