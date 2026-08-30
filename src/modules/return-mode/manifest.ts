import type { ModuleManifest } from '../../core/kernel/types.js';
import type { MessageRepository } from '../../core/channel/index.js';
import type { ItemService } from '../tasks/public/index.js';
import { ReturnModeService } from './return-mode-service.js';

export interface BuildReturnModeModuleDeps {
  readonly messageRepository: MessageRepository;
  readonly itemService: ItemService;
  now?: () => Date;
}

/**
 * `return-mode` (RF-10, spec FEAT-007): sem migração (estado derivado de
 * `messages`, Decisões tomadas), sem job/comando/tool próprios — é consumido
 * por `nudges` (supressão) e pelo webhook/dispatcher de captura (resumo de
 * reentrada) via `return-mode/public`.
 */
export function buildReturnModeModule(deps: BuildReturnModeModuleDeps): { manifest: ModuleManifest; service: ReturnModeService } {
  const service = new ReturnModeService({
    messageRepository: deps.messageRepository,
    itemService: deps.itemService,
    ...(deps.now ? { now: deps.now } : {}),
  });

  const manifest: ModuleManifest = { name: 'return-mode' };

  return { manifest, service };
}
