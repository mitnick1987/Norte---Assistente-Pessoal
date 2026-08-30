import type { CommandMatchContext, CommandMatcher, CommandResult } from '../../core/kernel/types.js';
import type { PendingMenuRepository } from '../../core/menu/index.js';
import type { ItemService } from '../tasks/public/index.js';

/**
 * Menu "1 manter / 2 adiar / 3 dropar" da decisão genérica da revisão
 * noturna (RF-06) — resolve só quando ele é a ÚLTIMA pergunta de menu
 * numérico feita (`pending_menus`, achado de review): sem isso, "1"/"2"/"3"
 * caía sempre no executor de cobrança quando havia uma pendente, mesmo que
 * fosse esta pergunta a mais recente.
 *
 * "1 manter" não muda nada — é a opção de "não decidir nada agora", não uma
 * transição de status.
 */

function normalize(text: string): string {
  return text.trim();
}

const FALLBACK_SNOOZE_DAYS = 1;

function buildReviewDecisionCommand(
  name: string,
  digit: '1' | '2' | '3',
  itemService: ItemService,
  pendingMenuRepository: PendingMenuRepository,
  now: () => Date,
): CommandMatcher {
  function findPendingItemId(): number | undefined {
    const pending = pendingMenuRepository.findMostRecentPending();
    if (!pending || pending.origin !== 'revisao') return undefined;
    return pending.itemId;
  }

  return {
    name,
    match: (ctx) => normalize(ctx.text) === digit && findPendingItemId() !== undefined,
    handle: async (_ctx: CommandMatchContext): Promise<CommandResult> => {
      const itemId = findPendingItemId();
      if (itemId === undefined) {
        return { replyText: 'Não achei nenhuma decisão pendente da revisão pra responder.' };
      }

      const pending = pendingMenuRepository.findMostRecentPending();
      if (pending) pendingMenuRepository.markResolved(pending.id, now());

      const item = itemService.findById(itemId);
      // Item já resolvido por outro caminho antes da resposta chegar
      // (mesma corrida do menu de cobrança) — encerra sem lançar.
      if (!item || !['ativa', 'em_andamento', 'adiada'].includes(item.status)) {
        return { replyText: 'Essa já tinha sido resolvida antes — nada pra fazer aqui.' };
      }

      if (digit === '1') {
        return { replyText: 'Beleza, mantive como está.' };
      }

      if (digit === '3') {
        await itemService.drop(itemId);
        return { replyText: 'Dropei. Se mudar de ideia, é só falar.' };
      }

      // "2 adiar": mesmo fallback de 1 dia usado pelo executor de "adia" sem
      // data explícita (RF-07) — nunca pergunta "para quando?" aqui também.
      const dueAt = new Date(now().getTime() + FALLBACK_SNOOZE_DAYS * 24 * 60 * 60_000);
      await itemService.snoozeToDate(itemId, dueAt);
      return { replyText: 'Adiei pra amanhã.' };
    },
  };
}

export function buildRitualsCommands(
  itemService: ItemService,
  pendingMenuRepository: PendingMenuRepository,
  now: () => Date = () => new Date(),
): CommandMatcher[] {
  return [
    buildReviewDecisionCommand('rituals.review.keep', '1', itemService, pendingMenuRepository, now),
    buildReviewDecisionCommand('rituals.review.snooze', '2', itemService, pendingMenuRepository, now),
    buildReviewDecisionCommand('rituals.review.drop', '3', itemService, pendingMenuRepository, now),
  ];
}
