import { google, type calendar_v3 } from 'googleapis';

/**
 * `OAuth2Client` vem de `google.auth.OAuth2` (reexportado por `googleapis`,
 * que já depende de `google-auth-library` internamente para o protocolo
 * OAuth2 — spec, Decisões tomadas), nunca de um import direto do pacote
 * `google-auth-library` como dependência própria: isso instalaria uma
 * segunda cópia física da lib, e com `exactOptionalPropertyTypes` ligado o
 * compilador trata as duas classes `OAuth2Client` como incompatíveis mesmo
 * sendo a "mesma" API. Usar sempre a via de `googleapis` garante um único
 * tipo em toda a cadeia (client de auth e client de calendar do mesmo
 * pacote).
 */
type OAuth2Client = InstanceType<typeof google.auth.OAuth2>;
const OAuth2Client = google.auth.OAuth2;

/** Escopo único e mínimo (ADR-010, spec item 1) — nunca `calendar` completo. */
export const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events';

export interface GoogleTokenSet {
  readonly accessToken: string;
  readonly refreshToken: string | undefined;
  readonly expiry: Date;
  readonly scopes: string;
}

export interface GoogleOAuthClientConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
}

export interface GoogleCalendarEventInput {
  readonly gcalId?: string;
  readonly title: string;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly location?: string;
}

export interface GoogleCalendarEventResult {
  readonly gcalId: string;
  readonly title: string;
  readonly start: { readonly dateTime?: string; readonly date?: string };
  readonly end: { readonly dateTime?: string; readonly date?: string };
  readonly location?: string;
}

/**
 * Porta estreita usada pelo serviço de domínio — o único ponto de contato
 * com `googleapis` (spec, Decisões tomadas). Testes stubam esta interface
 * inteira, nunca `fetch` por baixo dela (a lib não expõe esse ponto de
 * extensão como o `fetchFn` do provedor Anthropic).
 */
export interface GoogleOAuthPort {
  buildConsentUrl: (state: string) => string;
  exchangeCode: (code: string) => Promise<GoogleTokenSet>;
  refresh: (refreshToken: string) => Promise<GoogleTokenSet>;
  listEventsToday: (accessToken: string, timeMin: Date, timeMax: Date) => Promise<GoogleCalendarEventResult[]>;
  insertEvent: (accessToken: string, event: GoogleCalendarEventInput) => Promise<GoogleCalendarEventResult>;
}

function toEventResult(event: calendar_v3.Schema$Event): GoogleCalendarEventResult {
  return {
    gcalId: event.id ?? '',
    title: event.summary ?? '',
    start: { ...(event.start?.dateTime ? { dateTime: event.start.dateTime } : {}), ...(event.start?.date ? { date: event.start.date } : {}) },
    end: { ...(event.end?.dateTime ? { dateTime: event.end.dateTime } : {}), ...(event.end?.date ? { date: event.end.date } : {}) },
    ...(event.location ? { location: event.location } : {}),
  };
}

/**
 * Fronteira fina sobre `googleapis` (spec, Decisões tomadas): nenhuma
 * chamada HTTP própria, nenhuma reimplementação do protocolo OAuth2 — só
 * tradução de/para os tipos de domínio deste módulo, para o resto do
 * código (refresh, testes) nunca depender do shape exato do SDK.
 */
export class GoogleOAuthClient implements GoogleOAuthPort {
  private readonly client: OAuth2Client;

  constructor(config: GoogleOAuthClientConfig) {
    this.client = new OAuth2Client(config.clientId, config.clientSecret, config.redirectUri);
  }

  /**
   * `access_type: offline` + `prompt: consent` força reemissão do
   * refresh_token (spec item 1) — sem isso o Google só devolve na primeira
   * autorização. `state` é gerado e validado por quem chama
   * (GoogleCalendarService) — mitigação padrão de CSRF/injeção de código no
   * callback OAuth2; este client só repassa o valor, nunca decide sozinho.
   */
  buildConsentUrl(state: string): string {
    return this.client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'consent',
      scope: [GOOGLE_CALENDAR_SCOPE],
      state,
    });
  }

  async exchangeCode(code: string): Promise<GoogleTokenSet> {
    const { tokens } = await this.client.getToken(code);
    return this.toTokenSet(tokens);
  }

  async refresh(refreshToken: string): Promise<GoogleTokenSet> {
    this.client.setCredentials({ refresh_token: refreshToken });
    const { credentials } = await this.client.refreshAccessToken();
    return this.toTokenSet({ ...credentials, refresh_token: credentials.refresh_token ?? refreshToken });
  }

  /** `accessToken` já validado/renovado por quem chama (GoogleCalendarService) — este client nunca decide sozinho se o token está vencido. */
  async listEventsToday(accessToken: string, timeMin: Date, timeMax: Date): Promise<GoogleCalendarEventResult[]> {
    const calendar = google.calendar({ version: 'v3', auth: this.authorizedClient(accessToken) });
    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });
    return (response.data.items ?? []).map(toEventResult);
  }

  async insertEvent(accessToken: string, event: GoogleCalendarEventInput): Promise<GoogleCalendarEventResult> {
    const calendar = google.calendar({ version: 'v3', auth: this.authorizedClient(accessToken) });
    const requestBody: calendar_v3.Schema$Event = {
      ...(event.gcalId ? { id: event.gcalId } : {}),
      summary: event.title,
      start: { dateTime: event.startAt.toISOString() },
      end: { dateTime: event.endAt.toISOString() },
      ...(event.location ? { location: event.location } : {}),
    };
    const response = await calendar.events.insert({ calendarId: 'primary', requestBody });
    return toEventResult(response.data);
  }

  private authorizedClient(accessToken: string): OAuth2Client {
    const client = new OAuth2Client();
    client.setCredentials({ access_token: accessToken });
    return client;
  }

  private toTokenSet(tokens: {
    access_token?: string | null;
    refresh_token?: string | null;
    expiry_date?: number | null;
    scope?: string | null;
  }): GoogleTokenSet {
    if (!tokens.access_token) {
      throw new Error('Google OAuth: resposta sem access_token');
    }
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? undefined,
      expiry: tokens.expiry_date ? new Date(tokens.expiry_date) : new Date(Date.now() + 3_600_000),
      scopes: tokens.scope ?? GOOGLE_CALENDAR_SCOPE,
    };
  }
}
