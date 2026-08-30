import type { ModuleManifest } from '../../core/kernel/types.js';
import type { PendingMenuRepository } from '../../core/menu/index.js';
import type { ItemService } from '../tasks/public/index.js';
import { HygieneService } from './hygiene-service.js';
import { buildHygieneCommands } from './commands.js';

export interface BuildHygieneModuleDeps {
  readonly itemService: ItemService;
  readonly pendingMenuRepository: PendingMenuRepository;
  now?: () => Date;
}

/**
 * `hygiene` (RF-11, spec FEAT-007): sem migração própria (elegibilidade
 * deriva de `items.snooze_count`/`updated_at`, já existentes desde a
 * FEAT-002). A proposta é consumida por `rituals` dentro do job `revisao`
 * já existente (via `hygiene/public`), não um disparo novo na tabela `jobs`
 * — mas o menu "1/2/3" da proposta ganhou comando próprio (achado de review,
 * FEAT-007): resolve a decisão de higiene contra `pending_menus`, nunca
 * contra a cobrança de `nudges`.
 */
export function buildHygieneModule(deps: BuildHygieneModuleDeps): { manifest: ModuleManifest; service: HygieneService } {
  const now = deps.now ?? (() => new Date());
  const service = new HygieneService({ itemService: deps.itemService, now });

  const manifest: ModuleManifest = {
    name: 'hygiene',
    commands: buildHygieneCommands(deps.itemService, service, deps.pendingMenuRepository, now),
  };

  return { manifest, service };
}
