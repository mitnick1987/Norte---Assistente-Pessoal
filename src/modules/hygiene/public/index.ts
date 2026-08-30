/**
 * Contrato público de `hygiene` (ARCHITECTURE.md §2): `rituals` consome
 * `HygieneService` para incluir a proposta de higiene na revisão noturna
 * (RF-11) sem depender de nenhum interno do módulo.
 */
export { buildHygieneModule } from '../manifest.js';
export type { BuildHygieneModuleDeps } from '../manifest.js';
export { HygieneService } from '../hygiene-service.js';
export type { HygieneProposal } from '../domain/index.js';
