import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Database } from 'better-sqlite3';
import type { Logger } from 'pino';
import { startOfZonedDay, zonedTimeToUtc } from '../../../core/scheduler/domain/index.js';
import type { FailureAlerter } from '../../../core/outbox/index.js';
import type { EventService, ItemService } from '../../tasks/public/index.js';
import type { ChainService } from '../../chains/public/index.js';
import {
  AuthTokenNotFoundError,
  GOOGLE_CALENDAR_PROVIDER,
  mapGoogleEventToSync,
  type GoogleCalendarEvent,
} from './domain/index.js';
import type { AuthTokensRepository } from './auth-tokens-repository.js';
import type { GoogleOAuthPort } from './google-oauth-client.js';
import type { TokenCipher } from './token-cipher.js';

/** Margem de segurança antes do vencimento real (spec item 2: "vencido, ou a poucos minutos de vencer") — evita chamar a API com um token que expira no meio da requisição. */
const EXPIRY_SAFETY_MARGIN_MS = 5 * 60_000;

export interface GoogleCalendarServiceDeps {
  readonly db: Database;
  readonly tokensRepository: AuthTokensRepository;
  readonly oauthClient: GoogleOAuthPort;
  readonly cipher: TokenCipher;
  readonly eventService: EventService;
  readonly itemService: ItemService;
  readonly chainService: ChainService;
  readonly alerter: FailureAlerter;
  readonly logger: Logger;
  /** Mesmo default configurável que a captura por frase usa (FEAT-004) — lido a cada sincronização, não fixado no boot (o dono ajusta via settings sem redeploy). */
  readonly getDeslocamentoMinDefault: () => number;
  /** Injetável para teste — nunca `new Date()` direto (TESTING.md §7). */
  now?: () => Date;
}

export interface SyncedEventSummary {
  readonly gcalId: string;
  readonly title: string;
  readonly startAt: string;
  readonly endAt: string | null;
}

export interface CreateRemoteEventParams {
  readonly title: string;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly local?: string;
}

export interface RemoteEventCreated {
  readonly gcalId: string;
}

/** Falha de refresh nunca mascara sucesso (spec item 2, ADR-010) — propaga para quem chamou, depois de já ter disparado o alerta por e-mail. */
export class GoogleTokenRefreshError extends Error {
  constructor(cause: unknown) {
    super('falha ao renovar o token de acesso ao Google Calendar', { cause });
    this.name = 'GoogleTokenRefreshError';
  }
}

/** Callback sem `state` ou com valor que não confere com o gerado em `buildConsentUrl` — rejeita antes de trocar qualquer código (CSRF/injeção de código OAuth). */
export class InvalidOAuthStateError extends Error {
  constructor() {
    super('state do callback OAuth ausente ou inválido — refaça o setup a partir de GET /setup/google');
    this.name = 'InvalidOAuthStateError';
  }
}

/**
 * Orquestração do OAuth + sincronização mínima com cadeias (spec itens 2 e
 * 3). Nenhuma chamada à API do Google acontece sem passar por
 * `getValidAccessToken` primeiro — é o único ponto do módulo que decide se
 * o token precisa de refresh, e o único que dispara o alerta de falha
 * (SECURITY.md §4, ARCHITECTURE.md §6: falha de integração externa nunca é
 * silenciosa).
 */
export class GoogleCalendarService {
  private readonly now: () => Date;
  /**
   * State pendente do setup em curso, uso único (spec item 1 + achado de
   * segurança CSRF/injeção de código): setup é operação manual serial do
   * dono, então guardar em memória do processo é suficiente — não precisa
   * de tabela própria nem sobreviver a um restart no meio do fluxo (o dono
   * simplesmente reabre GET /setup/google e gera outro).
   */
  private pendingOAuthState: string | undefined;

  constructor(private readonly deps: GoogleCalendarServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  buildConsentUrl(): string {
    const state = randomBytes(32).toString('base64url');
    this.pendingOAuthState = state;
    return this.deps.oauthClient.buildConsentUrl(state);
  }

  async completeSetup(code: string, state: string | undefined): Promise<void> {
    if (!this.isValidState(state)) {
      throw new InvalidOAuthStateError();
    }
    // uso único: consumido na validação, confira ou não — reenvio do mesmo
    // callback (replay) não pode trocar código de novo com o state antigo.
    this.pendingOAuthState = undefined;

    const tokenSet = await this.deps.oauthClient.exchangeCode(code);
    if (!tokenSet.refreshToken) {
      // Sem `prompt=consent` na URL de setup o Google só reemite o refresh_token
      // na primeira autorização — se isso já foi feito antes e o dono repetir o
      // setup sem revogar o acesso, a troca vem sem ele. Falhar aqui é melhor
      // que gravar uma linha sem refresh_token que quebraria no primeiro refresh.
      throw new Error(
        'Google não devolveu refresh_token nesta troca — revogue o acesso em myaccount.google.com/permissions e refaça o setup',
      );
    }

    this.deps.tokensRepository.upsert({
      provider: GOOGLE_CALENDAR_PROVIDER,
      accessTokenEncrypted: this.deps.cipher.encrypt(tokenSet.accessToken),
      refreshTokenEncrypted: this.deps.cipher.encrypt(tokenSet.refreshToken),
      expiry: tokenSet.expiry,
      scopes: tokenSet.scopes,
    });
  }

  /** Comparação em tempo constante — mesmo padrão do filtro de JID (SECURITY.md §2), aqui contra adivinhação do state por timing. */
  private isValidState(received: string | undefined): boolean {
    if (!received || !this.pendingOAuthState) return false;
    const expectedBuf = Buffer.from(this.pendingOAuthState);
    const receivedBuf = Buffer.from(received);
    if (expectedBuf.length !== receivedBuf.length) return false;
    return timingSafeEqual(expectedBuf, receivedBuf);
  }

  /**
   * Único ponto de decisão de refresh (spec item 2): token vencido (ou a
   * `EXPIRY_SAFETY_MARGIN_MS` de vencer) é renovado antes de qualquer
   * chamada; token ainda válido não dispara refresh desnecessário. Falha de
   * refresh dispara alerta por e-mail e propaga — nunca mascara como
   * sucesso silencioso.
   */
  private async getValidAccessToken(): Promise<string> {
    const stored = this.deps.tokensRepository.findByProvider(GOOGLE_CALENDAR_PROVIDER);
    if (!stored) {
      throw new AuthTokenNotFoundError(GOOGLE_CALENDAR_PROVIDER);
    }

    const expiresAt = new Date(stored.expiry).getTime();
    const stillValid = expiresAt - this.now().getTime() > EXPIRY_SAFETY_MARGIN_MS;
    if (stillValid) {
      return this.deps.cipher.decrypt(stored.accessTokenEncrypted);
    }

    const refreshToken = this.deps.cipher.decrypt(stored.refreshTokenEncrypted);
    try {
      const refreshed = await this.deps.oauthClient.refresh(refreshToken);
      this.deps.tokensRepository.updateAccessToken(
        GOOGLE_CALENDAR_PROVIDER,
        this.deps.cipher.encrypt(refreshed.accessToken),
        refreshed.expiry,
      );
      return refreshed.accessToken;
    } catch (err) {
      // `err` nunca entra bruto no log: é erro gaxios/googleapis, cujo
      // serializer padrão do pino expande `config.data`/`headers`, onde vai
      // o corpo da requisição de refresh — refresh_token e client_secret em
      // texto plano (SECURITY.md §4). Só provider + mensagem já bastam para
      // investigar; mesmo padrão do email-alerter.ts.
      const message = err instanceof Error ? err.message : 'erro desconhecido';
      this.deps.logger.error(
        { provider: GOOGLE_CALENDAR_PROVIDER, message },
        'falha ao renovar token de acesso ao Google Calendar',
      );
      await this.deps.alerter.alertRefreshFailure({ provider: GOOGLE_CALENDAR_PROVIDER, err });
      throw new GoogleTokenRefreshError(err);
    }
  }

  /**
   * Agenda do dia (spec item 3): lida sob demanda, sem espelhar em tabela
   * própria (Decisões tomadas). Evento com horário e sem `event` interno
   * correspondente gera `event` + cadeia completa; evento já sincronizado
   * ou de dia inteiro é ignorado nesta chamada.
   */
  async listTodayAndSync(): Promise<SyncedEventSummary[]> {
    const accessToken = await this.getValidAccessToken();

    const dayStart = zonedTimeToUtc(startOfZonedDay(this.now()));
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60_000);

    const events = await this.deps.oauthClient.listEventsToday(accessToken, dayStart, dayEnd);

    for (const event of events) {
      this.syncEvent(event);
    }

    return events.map((event) => ({
      gcalId: event.gcalId,
      title: event.title,
      startAt: event.start.dateTime ?? event.start.date ?? '',
      endAt: event.end.dateTime ?? event.end.date ?? null,
    }));
  }

  /**
   * Escrita determinística (ADR-019, opção A): chamada pelo `capture-service`
   * quando a triagem classifica `compromisso` com data/hora resolvida —
   * nenhuma tool de LLM aqui, o registry `create_event` do brain fica para a
   * FEAT-006. Propaga qualquer falha (token ausente, refresh, erro de rede)
   * para o chamador decidir a degradação; este serviço nunca decide sozinho
   * se um evento sem Google é aceitável — quem sabe disso é a captura.
   */
  async createRemoteEvent(params: CreateRemoteEventParams): Promise<RemoteEventCreated> {
    const accessToken = await this.getValidAccessToken();
    const inserted = await this.deps.oauthClient.insertEvent(accessToken, {
      title: params.title,
      startAt: params.startAt,
      endAt: params.endAt,
      ...(params.local !== undefined ? { location: params.local } : {}),
    });
    return { gcalId: inserted.gcalId };
  }

  /**
   * item + event + cadeia numa única transação (mesmo padrão do
   * `capture-service`, achado de review pós-merge): sem isso um crash no
   * meio da sequência deixa item sem event ou event sem cadeia, e um retry
   * subsequente — sem idempotência nenhuma nesse meio-termo — duplicaria o
   * item para o mesmo compromisso do Google. O índice único parcial em
   * `events.gcal_id` (migração 006 de `tasks`) é a segunda linha de defesa:
   * se dois disparos concorrentes passarem pelo `findByGcalId` antes de um
   * deles escrever, o segundo insert estoura `SQLITE_CONSTRAINT` e vira
   * skip silencioso em vez de duplicar.
   */
  private syncEvent(googleEvent: GoogleCalendarEvent): void {
    const run = this.deps.db.transaction(() => {
      const decision = mapGoogleEventToSync(googleEvent, (gcalId) => Boolean(this.deps.eventService.findByGcalId(gcalId)));
      if (decision.action === 'skip') return;

      const item = this.deps.itemService.create({
        type: 'compromisso',
        title: googleEvent.title,
        origin: 'google_calendar',
        status: 'ativa',
        dueAt: decision.startAt,
      });

      const event = this.deps.eventService.create({
        itemId: item.id,
        title: googleEvent.title,
        startAt: decision.startAt,
        deslocamentoMin: this.deps.getDeslocamentoMinDefault(),
        gcalId: googleEvent.gcalId,
        ...(decision.endAt !== undefined ? { endAt: decision.endAt } : {}),
        ...(googleEvent.location !== undefined ? { local: googleEvent.location } : {}),
      });

      this.deps.chainService.scheduleForEvent(event);
    });

    try {
      run();
    } catch (err) {
      if (isUniqueConstraintError(err)) return;
      throw err;
    }
  }
}

/** `gcal_id` duplicado sob corrida (dois disparos de sync passaram no `findByGcalId` antes de qualquer um escrever) — a transação inteira desfaz e o evento fica pra próxima leitura, sem duplicar. */
function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Error && err.name === 'SqliteError' && err.message.includes('UNIQUE constraint failed');
}
