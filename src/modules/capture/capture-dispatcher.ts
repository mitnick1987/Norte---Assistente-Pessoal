import type { Logger } from 'pino';
import type { OutboxRepository } from '../../core/outbox/index.js';
import { buildCaptureConfirmation, pickConversationFallback } from './domain/index.js';
import type { CaptureService } from './capture-service.js';
import type { TriageService } from './triage-service.js';

export interface CaptureDispatcherDeps {
  readonly triageService: TriageService;
  readonly captureService: CaptureService;
  readonly outboxRepository: OutboxRepository;
  readonly logger: Logger;
  /** Injetável para teste — a seleção de variação de tom precisa ser reproduzível (TESTING.md §7). */
  now?: () => Date;
}

/**
 * Entra no webhook via `onUnmatchedText` (nenhum comando determinístico
 * bateu — RF-07 já resolveu "feito"/"adia"/"dropa"/"lista" antes de chegar
 * aqui). Fluxo 5 do PRD §6: triagem Haiku decide captura | comando | conversa.
 *
 * "comando" da triagem (ex.: variação de linguagem que o executor por
 * regex não pegou) ainda não tem um segundo executor aqui — nesta feature,
 * qualquer coisa que não seja "captura" cai na resposta padrão de conversa,
 * honesta sobre o que o sistema ainda não faz (spec, item 5).
 *
 * `messageId` (ADR-018) é o vínculo de idempotência: se a varredura de
 * recuperação chamar isto de novo para a mesma mensagem, `captureItems` já
 * detecta os itens gravados na tentativa anterior e não duplica — a
 * confirmação pode sair de novo (aceitável pela ADR), a gravação não.
 */
export function buildCaptureDispatcher(
  deps: CaptureDispatcherDeps,
): (text: string, jid: string, messageId: number) => Promise<void> {
  const now = deps.now ?? (() => new Date());

  return async (text: string, jid: string, messageId: number): Promise<void> => {
    const result = await deps.triageService.classify(text, jid);

    if (result.kind === 'error') {
      deps.outboxRepository.enqueue({ jid, body: pickConversationFallback(now().getTime()), isProactive: false });
      return;
    }

    if (result.output.classification !== 'captura' || result.output.items.length === 0) {
      deps.outboxRepository.enqueue({ jid, body: pickConversationFallback(now().getTime()), isProactive: false });
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
