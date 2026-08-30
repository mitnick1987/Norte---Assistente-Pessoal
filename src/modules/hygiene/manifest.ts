import type { ModuleManifest } from '../../core/kernel/types.js';
import type { ItemService } from '../tasks/public/index.js';
import { HygieneService } from './hygiene-service.js';

export interface BuildHygieneModuleDeps {
  readonly itemService: ItemService;
  now?: () => Date;
}

/**
 * `hygiene` (RF-11, spec FEAT-007): sem migração própria (elegibilidade
 * deriva de `items.snooze_count`/`updated_at`, já existentes desde a
 * FEAT-002), sem job/comando próprio — a proposta é consumida por `rituals`
 * dentro do job `revisao` já existente (via `hygiene/public`), não um
 * disparo novo na tabela `jobs`.
 */
export function buildHygieneModule(deps: BuildHygieneModuleDeps): { manifest: ModuleManifest; service: HygieneService } {
  const service = new HygieneService({ itemService: deps.itemService, ...(deps.now ? { now: deps.now } : {}) });

  const manifest: ModuleManifest = { name: 'hygiene' };

  return { manifest, service };
}
