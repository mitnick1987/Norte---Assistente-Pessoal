/**
 * Contrato público de `next-action` (ARCHITECTURE.md §2): usado só por
 * `app.ts` para compor o módulo — nenhum outro módulo depende dele.
 */
export { buildNextActionModule } from '../manifest.js';
export type { BuildNextActionModuleDeps } from '../manifest.js';
