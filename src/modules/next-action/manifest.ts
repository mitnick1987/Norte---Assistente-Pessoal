import type { ModuleManifest } from '../../core/kernel/types.js';
import type { ItemService } from '../tasks/public/index.js';
import { buildNextActionCommands } from './commands.js';

export interface BuildNextActionModuleDeps {
  readonly itemService: ItemService;
}

/**
 * `next-action` (RF-09, spec FEAT-007): só o comando determinístico — sem
 * migração (nenhuma tabela própria), sem job (não é proativo, é resposta a
 * uma pergunta do usuário), sem tool do brain (o vocabulário fixo já é
 * resolvido pelo executor antes de chegar ao Sonnet).
 */
export function buildNextActionModule(deps: BuildNextActionModuleDeps): { manifest: ModuleManifest } {
  const manifest: ModuleManifest = {
    name: 'next-action',
    commands: buildNextActionCommands(deps.itemService),
  };

  return { manifest };
}
