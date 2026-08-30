import type { MessageRepository } from '../../core/channel/index.js';
import { parseSqliteUtcTimestamp } from '../../core/channel/index.js';
import type { ItemService } from '../tasks/public/index.js';
import { buildReentrySummaryMessage, isReturnModeActive } from './domain/index.js';

export interface ReturnModeServiceDeps {
  readonly messageRepository: MessageRepository;
  readonly itemService: ItemService;
  now?: () => Date;
}

/**
 * Estado do modo retorno é sempre derivado de `messages` (Decisões tomadas
 * da spec FEAT-007) — nunca uma tabela própria. `isSuppressed` é consultado
 * por `nudges` antes de qualquer disparo de cobrança; `checkReentry` decide,
 * a cada mensagem de entrada nova, se essa é a reativação (e monta o resumo,
 * se for).
 */
export class ReturnModeService {
  private readonly now: () => Date;

  constructor(private readonly deps: ReturnModeServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  /**
   * Consultado antes de qualquer proativa não essencial disparar (cobrança,
   * spec item 3) — jobs de compromisso com hora (`reminder`) e os
   * rituais-âncora nunca chamam isto, o caminho crítico não pode depender de
   * uma consulta a mais para continuar funcionando (ADR-006).
   */
  isSuppressed(jid: string): boolean {
    const lastInbound = this.deps.messageRepository.findLastInbound(jid);
    return isReturnModeActive(lastInbound ? parseSqliteUtcTimestamp(lastInbound.createdAt) : undefined, this.now());
  }

  /**
   * Chamado com o `messageId` já gravado da mensagem de entrada que acabou
   * de chegar (ADR-018, mesmo vínculo do resto do webhook): decide se a
   * mensagem ANTERIOR a esta estava silente há 48h+ — se sim, esta é a
   * reativação e o resumo compacto deve ser enfileirado (uma vez só, nunca
   * despejando as cobranças represadas). `undefined` quando não é reativação.
   */
  checkReentry(jid: string, incomingMessageId: number): string | undefined {
    const now = this.now();
    const lastInbound = this.deps.messageRepository.findLastInboundBefore(jid, incomingMessageId);
    const wasActive = isReturnModeActive(
      lastInbound ? parseSqliteUtcTimestamp(lastInbound.createdAt) : undefined,
      now,
    );
    if (!wasActive) return undefined;

    return buildReentrySummaryMessage({
      silentDays: this.computeSilentDays(lastInbound!.createdAt, now),
      pendingCount: this.countPending(),
    });
  }

  private computeSilentDays(lastInboundAtIso: string, now: Date): number {
    const diffMs = now.getTime() - parseSqliteUtcTimestamp(lastInboundAtIso).getTime();
    return Math.floor(diffMs / (24 * 60 * 60 * 1000));
  }

  /** Contagem agregada, nunca lista (spec item 3): só quantos itens ativos existem, para o resumo dizer "N coisas paradas" sem citar nenhuma. */
  private countPending(): number {
    return this.deps.itemService.list({ includeInbox: false }).length;
  }
}
