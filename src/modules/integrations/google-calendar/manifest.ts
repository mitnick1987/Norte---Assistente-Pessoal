import type { Database } from 'better-sqlite3';
import type { Logger } from 'pino';
import type { ModuleManifest } from '../../../core/kernel/types.js';
import type { FailureAlerter } from '../../../core/outbox/index.js';
import type { EventService, ItemService } from '../../tasks/public/index.js';
import type { ChainService } from '../../chains/public/index.js';
import { googleCalendarMigrations } from './migrations/index.js';
import { AuthTokensRepository } from './auth-tokens-repository.js';
import { GoogleOAuthClient } from './google-oauth-client.js';
import { TokenCipher } from './token-cipher.js';
import { GoogleCalendarService } from './google-calendar-service.js';
import { buildGoogleCalendarTools } from './tools.js';

export interface GoogleCalendarConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
  readonly tokenEncryptionKey: string;
}

export interface BuildGoogleCalendarModuleDeps {
  readonly db: Database;
  readonly config: GoogleCalendarConfig;
  readonly eventService: EventService;
  readonly itemService: ItemService;
  readonly chainService: ChainService;
  readonly alerter: FailureAlerter;
  readonly logger: Logger;
  /** Mesmo default configurável que `capture` usa na captura por frase (FEAT-004) — o dono só configura uma vez, os dois pontos de entrada de compromisso reusam. */
  readonly getDeslocamentoMinDefault: () => number;
  /** Injetável para teste — nunca `new Date()` direto (TESTING.md §7). */
  readonly now?: () => Date;
}

/**
 * `google-calendar` (RF-12, spec FEAT-005; tool `create_event` FEAT-006):
 * migração própria de `auth_tokens` (não pertence a `tasks`, Decisões
 * tomadas). A leitura (`list_events`) é exposta pelo contrato público do
 * módulo para o briefing consumir diretamente; a escrita interativa nasce
 * aqui como tool do brain, sempre pelo mesmo `GoogleCalendarService` que o
 * caminho determinístico da captura usa (ADR-019).
 */
export function buildGoogleCalendarModule(deps: BuildGoogleCalendarModuleDeps): {
  manifest: ModuleManifest;
  service: GoogleCalendarService;
} {
  const tokensRepository = new AuthTokensRepository(deps.db);
  const oauthClient = new GoogleOAuthClient({
    clientId: deps.config.clientId,
    clientSecret: deps.config.clientSecret,
    redirectUri: deps.config.redirectUri,
  });
  const cipher = new TokenCipher(deps.config.tokenEncryptionKey);

  const service = new GoogleCalendarService({
    db: deps.db,
    tokensRepository,
    oauthClient,
    cipher,
    eventService: deps.eventService,
    itemService: deps.itemService,
    chainService: deps.chainService,
    alerter: deps.alerter,
    logger: deps.logger,
    getDeslocamentoMinDefault: deps.getDeslocamentoMinDefault,
    ...(deps.now ? { now: deps.now } : {}),
  });

  const manifest: ModuleManifest = {
    name: 'integrations-google-calendar',
    migrations: googleCalendarMigrations,
    tools: buildGoogleCalendarTools(service),
  };

  return { manifest, service };
}
