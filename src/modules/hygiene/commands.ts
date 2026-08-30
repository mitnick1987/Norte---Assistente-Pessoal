import type { CommandMatchContext, CommandMatcher, CommandResult } from '../../core/kernel/types.js';
import type { PendingMenuRepository } from '../../core/menu/index.js';
import type { ItemService } from '../tasks/public/index.js';
import type { HygieneService } from './hygiene-service.js';

/**
 * Menu "1 arquivar / 2 dropar / 3 adiar pra <mês que vem>" da proposta de
 * higiene (RF-11) — resolve só quando ele é a ÚLTIMA pergunta de menu
 * numérico feita (`pending_menus`, achado de review), nunca sequestrado por
 * uma cobrança pendente de mais cedo nem pela decisão genérica da revisão.
 */

function normalize(text: string): string {
  return text.trim();
}

function buildHygieneDecisionCommand(
  name: string,
  digit: '1' | '2' | '3',
  itemService: ItemService,
  hygieneService: HygieneService,
  pendingMenuRepository: PendingMenuRepository,
  now: () => Date,
): CommandMatcher {
  function findPendingItemId(): number | undefined {
    const pending = pendingMenuRepository.findMostRecentPending();
    if (!pending || pending.origin !== 'higiene') return undefined;
    return pending.itemId;
  }

  return {
    name,
    match: (ctx) => normalize(ctx.text) === digit && findPendingItemId() !== undefined,
    handle: async (_ctx: CommandMatchContext): Promise<CommandResult> => {
      const itemId = findPendingItemId();
      if (itemId === undefined) {
        return { replyText: 'Não achei nenhuma proposta de organização da lista pra responder.' };
      }

      const pending = pendingMenuRepository.findMostRecentPending();
      if (pending) pendingMenuRepository.markResolved(pending.id, now());

      const item = itemService.findById(itemId);
      // Item já resolvido por outro caminho antes da resposta chegar (mesma
      // corrida do menu de cobrança) — encerra sem lançar.
      if (!item || !['ativa', 'em_andamento', 'adiada'].includes(item.status)) {
        return { replyText: 'Essa já tinha sido resolvida antes — nada pra fazer aqui.' };
      }

      if (digit === '1') {
        itemService.archive(itemId);
        return { replyText: 'Arquivei. Se precisar, é só falar que eu trago de volta.' };
      }

      if (digit === '2') {
        await itemService.drop(itemId);
        return { replyText: 'Dropei. Se mudar de ideia, é só falar.' };
      }

      await hygieneService.applyNextMonthSnooze(itemId);
      return { replyText: 'Adiei pro mês que vem.' };
    },
  };
}

export function buildHygieneCommands(
  itemService: ItemService,
  hygieneService: HygieneService,
  pendingMenuRepository: PendingMenuRepository,
  now: () => Date = () => new Date(),
): CommandMatcher[] {
  return [
    buildHygieneDecisionCommand('hygiene.proposal.archive', '1', itemService, hygieneService, pendingMenuRepository, now),
    buildHygieneDecisionCommand('hygiene.proposal.drop', '2', itemService, hygieneService, pendingMenuRepository, now),
    buildHygieneDecisionCommand('hygiene.proposal.snooze', '3', itemService, hygieneService, pendingMenuRepository, now),
  ];
}
