import type { Logger } from 'pino';
import type { OutboxRepository } from '../../core/outbox/index.js';
import { LlmRequestError } from '../../core/llm/index.js';
import { buildCaptureConfirmation, pickConversationFallback } from './domain/index.js';
import type { CaptureService } from './capture-service.js';
import type { TriageService } from './triage-service.js';
import type { BrainService, RecentMessage } from './brain-service.js';

export interface CaptureDispatcherDeps {
  readonly triageService: TriageService;
  readonly captureService: CaptureService;
  readonly outboxRepository: OutboxRepository;
  readonly logger: Logger;
  /**
   * Ausente só em teste que não exercita conversa livre — em produção
   * sempre presente (`buildApp` sempre monta o brain, ANTHROPIC_API_KEY é
   * obrigatória no boot). Quando ausente, `conversa` cai na resposta fixa
   * honesta (mesmo comportamento pré-FEAT-006).
   */
  readonly brainService?: BrainService;
  /** Janela de conversa recente (spec item 4) — vem de `messageRepository.findRecentConversation`, nunca lida direto por este módulo. */
  readonly getRecentConversation?: (jid: string) => readonly RecentMessage[];
  /** Injetável para teste — a seleção de variação de tom precisa ser reproduzível (TESTING.md §7). */
  now?: () => Date;
}

/**
 * Entra no webhook via `onUnmatchedText` (nenhum comando determinístico
 * bateu — RF-07 já resolveu "feito"/"adia"/"dropa"/"lista" antes de chegar
 * aqui). Fluxo 5 do PRD §6: triagem Haiku decide captura | comando | conversa.
 *
 * "comando" da triagem (ex.: variação de linguagem que o executor por
 * regex não pegou) ainda não tem um segundo executor aqui — cai em
 * `conversa` como qualquer outra pergunta (FEAT-006 liga o brain de verdade
 * para esse caso; RF-09 "qual a próxima?" fica de fora por decisão da spec,
 * ver Decisões tomadas da FEAT-006).
 *
 * `messageId` (ADR-018) é o vínculo de idempotência: se a varredura de
 * recuperação chamar isto de novo para a mesma mensagem, `captureItems` já
 * detecta os itens gravados na tentativa anterior e não duplica — a
 * confirmação pode sair de novo (aceitável pela ADR), a gravação não. O
 * brain de conversa não tem essa mesma garantia (não há uma "gravação"
 * única para deduplicar): reprocessamento de uma mensagem de `conversa`
 * pode gerar uma segunda resposta, mesma tolerância que a resposta fixa já
 * tinha antes desta feature.
 */
export function buildCaptureDispatcher(
  deps: CaptureDispatcherDeps,
): (text: string, jid: string, messageId: number) => Promise<void> {
  const now = deps.now ?? (() => new Date());

  const replyConversation = async (text: string, jid: string, messageId: number): Promise<void> => {
    if (!deps.brainService) {
      deps.outboxRepository.enqueue({ jid, body: pickConversationFallback(now().getTime()), isProactive: false });
      return;
    }

    try {
      const history = deps.getRecentConversation?.(jid) ?? [];
      const reply = await deps.brainService.reply(text, history, messageId);
      deps.outboxRepository.enqueue({ jid, body: reply, isProactive: false });
    } catch (err) {
      if (err instanceof LlmRequestError) {
        deps.logger.warn({ err }, 'brain: falha ao chamar o Sonnet, caindo em resposta padrão de conversa');
        deps.outboxRepository.enqueue({ jid, body: pickConversationFallback(now().getTime()), isProactive: false });
        return;
      }
      throw err;
    }
  };

  return async (text: string, jid: string, messageId: number): Promise<void> => {
    const result = await deps.triageService.classify(text, jid);

    if (result.kind === 'error') {
      await replyConversation(text, jid, messageId);
      return;
    }

    if (result.output.classification !== 'captura' || result.output.items.length === 0) {
      await replyConversation(text, jid, messageId);
      return;
    }

    const captured = await deps.captureService.captureItems(result.output.items, messageId, now());

    // Reprocessamento idempotente (ADR-018): `captured` vem vazio quando a
    // mensagem já tinha gravado os itens numa tentativa anterior. A
    // confirmação ainda pode sair de novo (aceitável pela ADR) — usamos os
    // itens originais da triagem só pra manter contagem/título corretos,
    // sem o aviso de data (não sabemos mais se foi resolvida da vez passada).
    const confirmationItems =
      captured.length > 0
        ? captured
        : result.output.items.map((item) => ({ title: item.title, dueExpressionUnresolved: false }));

    const confirmation = buildCaptureConfirmation(confirmationItems, now().getTime());
    deps.outboxRepository.enqueue({ jid, body: confirmation, isProactive: false });
  };
}
