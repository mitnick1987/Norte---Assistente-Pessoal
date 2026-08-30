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
 * Sem cobrança pendente, "1"/"2"/"3" solto não bate aqui — cai em conversa
 * como qualquer texto não reconhecido (comportamento já existente).
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
