import type { Database } from 'better-sqlite3';
import type { ModuleManifest } from '../../core/kernel/types.js';
import type { TasksEventEmitter } from './domain/index.js';
import { tasksMigrations } from './migrations/index.js';
import { ItemsRepository } from './items-repository.js';
import { ItemService } from './item-service.js';
import { EventsRepository } from './events-repository.js';
import { EventService } from './event-service.js';
import { buildTasksTools } from './tools.js';
import { buildTasksCommands } from './commands.js';

export interface BuildTasksModuleDeps {
  /** Publica `item.dropped`/`item.rescheduled` no bus (FEAT-004) — omitido em teste que não precisa de `chains` reagindo. */
  readonly emit?: TasksEventEmitter;
}

/**
 * Fábrica em vez de manifesto estático: `tasks` precisa da conexão do
 * banco para montar repository/serviço antes de expor tools/commands, e o
 * kernel só injeta `db` na composição do app (ARCHITECTURE.md §2). Os
 * serviços construídos aqui são os mesmos reexportados em public/ para os
 * módulos que só precisam do contrato (ex.: capture).
 */
export function buildTasksModule(
  db: Database,
  deps: BuildTasksModuleDeps = {},
): { manifest: ModuleManifest; service: ItemService; eventService: EventService } {
  const repository = new ItemsRepository(db);
  const service = new ItemService(repository, undefined, deps.emit);

  const eventsRepository = new EventsRepository(db);
  const eventService = new EventService(eventsRepository);

  const manifest: ModuleManifest = {
    name: 'tasks',
    migrations: tasksMigrations,
    tools: buildTasksTools(service),
    commands: buildTasksCommands(service),
  };

  return { manifest, service, eventService };
}
