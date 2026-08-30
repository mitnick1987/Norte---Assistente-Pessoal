import Database from 'better-sqlite3';
import { runMigrations } from '../../src/core/db/migrator.js';
import { coreMigrations } from '../../src/core/db/migrations/index.js';
import { JobRepository } from '../../src/core/scheduler/index.js';
import { SettingsStore } from '../../src/core/settings/index.js';
import { EventBus } from '../../src/core/bus/index.js';
import { buildTasksModule } from '../../src/modules/tasks/public/index.js';
import { buildChainsModule } from '../../src/modules/chains/public/index.js';
import { CaptureService, type RemoteCalendarPort } from '../../src/modules/capture/capture-service.js';

const noopLogger = { info: () => undefined, warn: () => undefined, error: () => undefined } as never;

/**
 * Monta `tasks` + `chains` reais (mesmo caminho de `buildApp`, sem HTTP) —
 * usado pelos testes unitários de `capture-service`/`capture-dispatcher`
 * que precisam da cadeia de compromisso funcionando de ponta a ponta sem
 * subir o app inteiro (TESTING.md §7: nunca mockar o SQLite).
 *
 * `googleCalendarService` ausente por padrão reproduz o caso "dono nunca
 * autorizou o Google" (ADR-019) — os testes que exercitam o caminho
 * autorizado passam um stub próprio.
 */
export function buildCaptureTestContext(
  overrides: { now?: () => Date; googleCalendarService?: RemoteCalendarPort } = {},
) {
  const db = new Database(':memory:');
  const settings = new SettingsStore(db);
  const eventBus = new EventBus<Record<string, unknown>>();

  const { manifest: tasksManifest, service: itemService, eventService } = buildTasksModule(db, {
    emit: (event, payload) => eventBus.emit(event, payload),
  });
  const { manifest: chainsManifest, service: chainService } = buildChainsModule({
    eventService,
    jobRepository: new JobRepository(db),
    settings,
    ...(overrides.now ? { now: overrides.now } : {}),
  });

  runMigrations(db, [...coreMigrations, ...(tasksManifest.migrations ?? []), ...(chainsManifest.migrations ?? [])]);
  settings.seedDefaults({ ...tasksManifest.settingsDefaults, ...chainsManifest.settingsDefaults });

  for (const [eventName, handler] of Object.entries({ ...tasksManifest.events, ...chainsManifest.events })) {
    if (handler) eventBus.on(eventName, handler as (payload: unknown) => void | Promise<void>);
  }

  const jobRepository = new JobRepository(db);
  const captureService = new CaptureService({
    itemService,
    eventService,
    chainService,
    jobRepository,
    db,
    logger: noopLogger,
    ...(overrides.googleCalendarService ? { googleCalendarService: overrides.googleCalendarService } : {}),
    getDeslocamentoMinDefault: () => 30,
  });

  return { db, itemService, eventService, chainService, jobRepository, captureService, settings, eventBus };
}
