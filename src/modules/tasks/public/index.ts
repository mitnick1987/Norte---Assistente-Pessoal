/**
 * Contrato público de `tasks` (ARCHITECTURE.md §2): único ponto de acesso
 * que outros módulos podem importar. `capture` cria itens por aqui — nunca
 * por SQL direto nem por import de arquivo interno do módulo.
 */
export { buildTasksModule } from '../manifest.js';
export { ItemService } from '../item-service.js';
export type { CreateItemParams, ListItemsParams } from '../item-service.js';
export { ItemNotFoundError } from '../item-service.js';
export type { ItemType, ItemOrigin, ItemStatus, ItemPriority, ItemRecord } from '../domain/index.js';
export { InvalidStatusTransitionError } from '../domain/index.js';
/**
 * Exposto para `capture` resolver `dueExpression` da triagem (ADR-006): a
 * mesma resolução determinística de data relativa usada por "adia" também
 * resolve a expressão que o Haiku devolve — um único parser, um único
 * contrato de fuso (America/Sao_Paulo).
 */
export { parseRelativeDatePtBr } from '../domain/index.js';
export type { ParsedRelativeDate } from '../domain/index.js';
