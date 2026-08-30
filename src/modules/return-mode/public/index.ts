/**
 * Contrato público de `return-mode` (ARCHITECTURE.md §2): `nudges` consulta
 * `isSuppressed` antes de cobrar; o dispatcher de captura consulta
 * `checkReentry` a cada mensagem de entrada nova.
 */
export { buildReturnModeModule } from '../manifest.js';
export type { BuildReturnModeModuleDeps } from '../manifest.js';
export { ReturnModeService } from '../return-mode-service.js';
