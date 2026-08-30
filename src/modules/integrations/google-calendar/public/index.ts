/**
 * Contrato público de `integrations/google-calendar` (ARCHITECTURE.md §2):
 * único ponto de acesso que outros módulos (o futuro `rituals`/briefing,
 * FEAT-006) podem importar.
 */
export { buildGoogleCalendarModule } from '../manifest.js';
export type { BuildGoogleCalendarModuleDeps, GoogleCalendarConfig } from '../manifest.js';
export { GoogleCalendarService, GoogleTokenRefreshError, InvalidEventDateError } from '../google-calendar-service.js';
export type {
  SyncedEventSummary,
  CreateRemoteEventParams,
  RemoteEventCreated,
  CreateEventFromBrainParams,
  BrainEventCreated,
} from '../google-calendar-service.js';
export { registerGoogleCalendarSetupRoutes } from '../setup-routes.js';
export { GOOGLE_CALENDAR_SCOPE } from '../google-oauth-client.js';
export { AuthTokenNotFoundError } from '../domain/index.js';
export { buildGoogleCalendarTools } from '../tools.js';
