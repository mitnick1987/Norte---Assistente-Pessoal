import type { CommandMatchContext, CommandMatcher, CommandResult } from '../../core/kernel/types.js';
import { pickCompletionMessage, type ItemService } from '../tasks/public/index.js';
import type { NudgeService } from './nudge-service.js';

/**
 * Menu "1 feito / 2 reagendar / 3 dropar" (RF-08): resolve sobre a cobrança
 * mais recente ainda sem resposta (`NudgeService.findPendingChargeItemId`),
 * nunca sobre "o item mais recente citado na conversa" em geral — algo novo
 * pode ter sido capturado depois da cobrança sair, e a resposta numérica é
 * sempre sobre o que foi cobrado, não sobre o que veio depois.
 *
 * `findPendingChargeItemId` já filtra por `pending_menus` (achado de
 * review): só resolve aqui se a cobrança também for a ÚLTIMA pergunta de
 * menu numérico feita — uma cobrança da manhã sem resposta nunca sequestra o
 * dígito de um menu de revisão/higiene emitido depois. Sem cobrança pendente
 * (ou com outra origem na frente), "1"/"2"/"3" solto não bate aqui — cai em
 * conversa como qualquer texto não reconhecido.
 */

function normalize(text: string): string {
  return text.trim();
}

function buildChargeCommand(
  name: string,
  digit: '1' | '2' | '3',
  itemService: ItemService,
  nudgeService: NudgeService,
): CommandMatcher {
  return {
    name,
    match: (ctx) => normalize(ctx.text) === digit && nudgeService.findPendingChargeItemId() !== undefined,
    handle: async (_ctx: CommandMatchContext): Promise<CommandResult> => {
      const itemId = nudgeService.findPendingChargeItemId();
      if (itemId === undefined) {
        return { replyText: 'Não achei nenhuma cobrança pendente pra responder.' };
      }

      // Item já em estado terminal (feita/dropada/arquivada) antes da
      // resposta chegar — corrida com outro caminho que fechou o item
      // primeiro (achado de review). Encerra a cobrança sem lançar: nenhuma
      // transição inválida, resposta neutra, o item já está resolvido.
      if (nudgeService.isChargedItemTerminal(itemId)) {
        nudgeService.recordResponse();
        return { replyText: 'Essa já tinha sido resolvida antes — nada pra fazer aqui.' };
      }

      if (digit === '1') {
        itemService.complete(itemId);
        nudgeService.recordResponse();
        return { replyText: pickCompletionMessage(itemId) };
      }

      if (digit === '3') {
        await itemService.drop(itemId);
        nudgeService.recordResponse();
        return { replyText: 'Dropei. Se mudar de ideia, é só falar.' };
      }

      // "2 reagendar": aplica a data proposta direto (spec item 1) — nunca
      // pergunta "para quando?". A proposta já é calculada a partir de
      // `patterns` (ou do fallback de settings) e aplicada nesta mesma
      // resposta, sem exigir um segundo turno de confirmação.
      const reply = await nudgeService.applyReschedule(itemId);
      nudgeService.recordResponse();
      return { replyText: reply };
    },
  };
}

export function buildNudgesCommands(itemService: ItemService, nudgeService: NudgeService): CommandMatcher[] {
  return [
    buildChargeCommand('nudges.charge.complete', '1', itemService, nudgeService),
    buildChargeCommand('nudges.charge.reschedule', '2', itemService, nudgeService),
    buildChargeCommand('nudges.charge.drop', '3', itemService, nudgeService),
  ];
}
