import type { Database } from 'better-sqlite3';
import type { ModuleManifest } from '../../core/kernel/types.js';
import { tasksMigrations } from './migrations/index.js';
import { ItemsRepository } from './items-repository.js';
import { ItemService } from './item-service.js';
import { buildTasksTools } from './tools.js';
import { buildTasksCommands } from './commands.js';

/**
 * Fábrica em vez de manifesto estático: `tasks` precisa da conexão do
 * banco para montar repository/serviço antes de expor tools/commands, e o
 * kernel só injeta `db` na composição do app (ARCHITECTURE.md §2). O
 * serviço construído aqui é o mesmo reexportado em public/ para os módulos
 * que só precisam do contrato (ex.: capture).
 */
export function buildTasksModule(db: Database): { manifest: ModuleManifest; service: ItemService } {
  const repository = new ItemsRepository(db);
  const service = new ItemService(repository);

  const manifest: ModuleManifest = {
    name: 'tasks',
    migrations: tasksMigrations,
    tools: buildTasksTools(service),
    commands: buildTasksCommands(service),
  };

  return { manifest, service };
}
