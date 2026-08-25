import type { ModuleManifest } from '../../core/kernel/types.js';
import { pingCommand } from './command.js';

export const echoModule: ModuleManifest = {
  name: 'echo',
  commands: [pingCommand],
};
