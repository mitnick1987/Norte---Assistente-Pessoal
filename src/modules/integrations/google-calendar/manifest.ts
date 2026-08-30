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
 * `google-calendar` (RF-12, spec FEAT-005): migração própria de
 * `auth_tokens` (não pertence a `tasks`, Decisões tomadas), sem tools nem
 * commands nesta entrega — a leitura (`list_events`) é exposta pelo
 * contrato público do módulo para o futuro briefing (FEAT-006) consumir
 * diretamente, e a escrita interativa (`create_event`) ainda depende de uma
 * decisão de arquitetura em aberto (ver Entrega da spec).
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
  };

  return { manifest, service };
}
