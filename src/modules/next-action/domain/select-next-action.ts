import { selectTopPriorities, type PrioritizableItem } from '../../tasks/public/index.js';

export interface NextAction {
  readonly id: number;
  readonly title: string;
}

/**
 * "Qual a próxima?" (RF-09): sempre UMA ação, nunca uma lista — mesmo
 * critério de desempate do briefing (prazo mais próximo, depois prioridade
 * explícita, depois id), reusado de `tasks/domain` para as duas perguntas
 * nunca divergirem silenciosamente (spec, Decisões tomadas). `undefined`
 * sem candidato elegível — quem chama decide a resposta honesta, nunca
 * "não entendi".
 */
export function selectNextAction(items: readonly PrioritizableItem[]): NextAction | undefined {
  const [top] = selectTopPriorities(items, 1);
  return top ? { id: top.id, title: top.title } : undefined;
}
