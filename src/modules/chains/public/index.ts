/**
 * Contrato público de `chains` (ARCHITECTURE.md §2): `capture` importa daqui
 * para expandir a cadeia na captura de um compromisso, e o handler do job
 * `reminder` (em `capture`) importa os templates daqui para reconhecer
 * `tipoCadeia` no payload — nunca acessando o interno do módulo.
 */
export {
  buildChainsModule,
  CHAINS_DESLOCAMENTO_MIN_DEFAULT_SETTING,
  CHAINS_DESLOCAMENTO_MIN_DEFAULT_DEFAULT,
} from '../manifest.js';
export type { BuildChainsModuleDeps } from '../manifest.js';
export { ChainService } from '../chain-service.js';
export {
  buildVesperaMessage,
  buildManhaMessage,
  buildPreparoMessage,
} from '../domain/index.js';
export type { ChainStageType } from '../domain/index.js';
