import type { CommandMatchContext, CommandMatcher, CommandResult } from '../../core/kernel/types.js';
import { pickCompletionMessage } from './domain/index.js';
import type { ItemService } from './item-service.js';

/**
 * Executor determinístico (RF-07): resolve por código, nunca aciona o
 * Sonnet. Vive dentro de `tasks` por coesão (ver Decisões tomadas da
 * FEAT-002) — a mesma lógica de domínio que já resolve transição de estado,
 * vista por outro ângulo (texto → ação em vez de tool call → ação).
 *
 * Todos os comandos aqui operam sobre o item mais recentemente citado na
 * conversa (RF-07: "respostas numéricas/comandos referentes ao último item
 * citado"). Sem um item ativo, a resposta é honesta sobre isso — nunca
 * inventa um ID.
 */

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

const DONE_PATTERNS = ['feito', 'pronto', 'concluido', 'concluído', 'terminei', 'fiz'];
const DROP_PATTERNS = ['dropa', 'dropar', 'cancela isso', 'esquece isso'];
const LIST_PATTERNS = ['lista', 'me mostra tudo', 'mostra tudo', 'lista tudo', 'listar'];
const SNOOZE_PREFIX = 'adia';

function matchesAny(text: string, patterns: readonly string[]): boolean {
  return patterns.some((p) => text === p || text.startsWith(`${p} `));
}

export function buildTasksCommands(service: ItemService): CommandMatcher[] {
  const completeCommand: CommandMatcher = {
    name: 'tasks.complete',
    match: (ctx) => matchesAny(normalize(ctx.text), DONE_PATTERNS),
    handle: async (_ctx: CommandMatchContext): Promise<CommandResult> => {
      const target = service.findMostRecentActive();
      if (!target) {
        return { replyText: 'Não achei nenhum item ativo pra marcar como feito.' };
      }
      service.complete(target.id);
      return { replyText: pickCompletionMessage(target.id) };
    },
  };

  const dropCommand: CommandMatcher = {
    name: 'tasks.drop',
    match: (ctx) => matchesAny(normalize(ctx.text), DROP_PATTERNS),
    handle: async (): Promise<CommandResult> => {
      const target = service.findMostRecentActive();
      if (!target) {
        return { replyText: 'Não achei nenhum item ativo pra dropar.' };
      }
      await service.drop(target.id);
      return { replyText: 'Dropei. Se mudar de ideia, é só falar.' };
    },
  };

  const snoozeCommand: CommandMatcher = {
    name: 'tasks.snooze',
    match: (ctx) => normalize(ctx.text).startsWith(SNOOZE_PREFIX),
    handle: async (ctx: CommandMatchContext): Promise<CommandResult> => {
      const target = service.findMostRecentActive();
      if (!target) {
        return { replyText: 'Não achei nenhum item ativo pra adiar.' };
      }

      const relativeDateText = normalize(ctx.text).slice(SNOOZE_PREFIX.length).trim();
      const result = await service.snoozeByText(target.id, relativeDateText);
      if (!result) {
        return { replyText: 'Não entendi pra quando adiar — tenta "adia sexta" ou "adia amanhã 14h".' };
      }
      return { replyText: 'Adiei.' };
    },
  };

  const listCommand: CommandMatcher = {
    name: 'tasks.list',
    match: (ctx) => matchesAny(normalize(ctx.text), LIST_PATTERNS),
    handle: async (): Promise<CommandResult> => {
      const items = service.list();
      if (items.length === 0) {
        return { replyText: 'Sua lista está vazia agora.' };
      }
      const lines = items.map((item) => `- ${item.title}${item.dueAt ? ` (${formatDueAt(item.dueAt)})` : ''}`);
      return { replyText: lines.join('\n') };
    },
  };

  return [completeCommand, dropCommand, snoozeCommand, listCommand];
}

function formatDueAt(dueAtIso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(dueAtIso));
}
