import type { CommandMatchContext, CommandMatcher, CommandResult } from '../../core/kernel/types.js';
import type { ItemService } from '../tasks/public/index.js';
import { selectNextAction } from './domain/index.js';

/**
 * "Qual a próxima?" (RF-07/RF-09): executor determinístico, nunca aciona o
 * Sonnet — mesma régua do resto do executor em `modules/tasks/commands.ts`.
 * Reconhece só o vocabulário fixo da spec; formulação livre fora daqui cai
 * em conversa (comportamento já existente desde a FEAT-006).
 */

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

const NEXT_ACTION_PATTERNS = [
  'qual a proxima',
  'qual proxima',
  'o que eu faco agora',
  'o que faco agora',
  'proximo passo',
  'qual o proximo passo',
] as const;

function matchesNextAction(text: string): boolean {
  return NEXT_ACTION_PATTERNS.some((p) => text === p || text.startsWith(`${p}?`) || text.startsWith(`${p} `));
}

const NOTHING_PENDING_MESSAGE = 'Nada pendente agora.';

export function buildNextActionCommands(itemService: ItemService): CommandMatcher[] {
  const nextActionCommand: CommandMatcher = {
    name: 'next-action.query',
    match: (ctx) => matchesNextAction(normalize(ctx.text)),
    handle: async (_ctx: CommandMatchContext): Promise<CommandResult> => {
      const candidates = itemService.list({ includeInbox: false });
      const next = selectNextAction(candidates);

      if (!next) {
        return { replyText: NOTHING_PENDING_MESSAGE };
      }

      return { replyText: next.title };
    },
  };

  return [nextActionCommand];
}
