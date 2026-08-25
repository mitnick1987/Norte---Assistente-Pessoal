import type { CommandMatcher, CommandMatchContext, CommandResult } from '../../core/kernel/types.js';

/**
 * Prova de conceito do pipeline (kernel + commands + channel + outbox) sem
 * nenhuma chamada de LLM. Remoção prevista assim que tasks (FEAT-002)
 * chegar — ver docs/features/FEAT-001-fundacao.md.
 */
function matchPing(ctx: CommandMatchContext): boolean {
  return ctx.text.trim().toLowerCase() === 'ping';
}

async function handlePing(_ctx: CommandMatchContext): Promise<CommandResult> {
  return { replyText: 'pong' };
}

export const pingCommand: CommandMatcher = {
  name: 'echo.ping',
  match: matchPing,
  handle: handlePing,
};
