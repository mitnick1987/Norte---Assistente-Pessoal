import type { Logger } from 'pino';
import type { OutboxRepository } from '../../core/outbox/index.js';
import { startOfZonedDay, toZonedParts, zonedTimeToUtc } from '../../core/scheduler/domain/index.js';
import { selectTopPriorities, type ItemService } from '../tasks/public/index.js';
import type { ReturnModeService } from '../return-mode/public/index.js';
import {
  buildChargeMessage,
  buildRescheduleMessage,
  buildRescheduleProposal,
  selectNudgeEligible,
  type NudgeCandidateItem,
} from './domain/index.js';
import type { ChargesRepository } from './charges-repository.js';
import type { PatternsRepository } from './patterns-repository.js';

const TOP_PRIORITIES_COUNT = 3;
const RESPONSE_SAMPLE_WINDOW = 10;

export interface NudgeServiceDeps {
  readonly itemService: ItemService;
  readonly chargesRepository: ChargesRepository;
  readonly patternsRepository: PatternsRepository;
  readonly outboxRepository: OutboxRepository;
  readonly returnModeService: ReturnModeService;
  readonly ownerJid: string;
  readonly logger: Logger;
  readonly getDailyChargeCap: () => number;
  readonly getFallbackSnoozeHour: () => number;
  readonly getFallbackSnoozeMinute: () => number;
  now?: () => Date;
}

/** Dia civil America/Sao_Paulo no formato `YYYY-MM-DD` — chave de `nudges_charges.charged_on` e do teto diário. */
function zonedDayKey(date: Date): string {
  const parts = toZonedParts(date);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

/**
 * Dia da semana LOCAL (0 = domingo) em America/Sao_Paulo — nunca
 * `date.getUTCDay()` do instante cru, que pode virar o dia UTC seguinte
 * perto da meia-noite local (ex.: 23h de sábado em SP = 02h de domingo em
 * UTC). Fixar a meia-noite local antes de converter garante que o dia UTC
 * resultante é sempre o mesmo dia civil de SP (offset fixo -03:00).
 */
function zonedWeekday(date: Date): number {
  return zonedTimeToUtc(startOfZonedDay(date)).getUTCDay();
}

/**
 * Fechamento de loop (RF-08, spec FEAT-007 item 1): orquestra elegibilidade
 * + envio da cobrança, e a resolução do menu 1/2/3. O job `cobranca`
 * (manifest.ts) só chama `checkAndSendDue()`; os comandos (commands.ts) só
 * chamam `findPendingChargeItemId()`/`recordResponse()`/`applyReschedule()`
 * — nenhum dos dois reimplementa a regra de elegibilidade ou de proposta.
 */
export class NudgeService {
  private readonly now: () => Date;

  constructor(private readonly deps: NudgeServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  /**
   * Chamado pelo job `cobranca` (poll do scheduler, ADR-004): seleciona
   * candidatos elegíveis e envia no máximo o que o teto diário ainda
   * permite. Supressor do modo retorno é consultado aqui, não deixado para o
   * outbox decidir — a cobrança nem chega a ser considerada elegível
   * enquanto o modo retorno estiver ativo (spec item 3).
   */
  async checkAndSendDue(): Promise<void> {
    const now = this.now();
    const dayKey = zonedDayKey(now);
    const returnModeSuppressed = this.deps.returnModeService.isSuppressed(this.deps.ownerJid);

    const activeItems = this.deps.itemService.list({ includeInbox: false });
    const topPriorityIds = new Set(
      selectTopPriorities(
        activeItems.map((item) => ({ id: item.id, title: item.title, priority: item.priority, dueAt: item.dueAt })),
        TOP_PRIORITIES_COUNT,
      ).map((item) => item.id),
    );

    const chargeableStatuses = new Set(['ativa', 'em_andamento', 'adiada']);
    const candidates: NudgeCandidateItem[] = activeItems
      .filter((item) => chargeableStatuses.has(item.status))
      .map((item) => ({
        id: item.id,
        title: item.title,
        status: item.status as NudgeCandidateItem['status'],
        dueAt: item.dueAt,
        isUnconfirmedTopPriority: topPriorityIds.has(item.id),
      }));

    const eligible = selectNudgeEligible(candidates, {
      now,
      chargesSentToday: this.deps.chargesRepository.countChargedOn(dayKey),
      dailyChargeCap: this.deps.getDailyChargeCap(),
      returnModeSuppressed,
      itemIdsChargedToday: this.deps.chargesRepository.findItemIdsChargedOn(dayKey),
    });

    if (eligible.length > 0) {
      this.deps.logger.info({ count: eligible.length, returnModeSuppressed }, 'cobrança: itens elegíveis nesta checagem');
    }

    for (const item of eligible) {
      this.deps.chargesRepository.record(item.id, dayKey);
      this.deps.outboxRepository.enqueue({
        jid: this.deps.ownerJid,
        body: buildChargeMessage(item),
        isProactive: true,
      });
    }
  }

  /**
   * Resolve "1"/"2"/"3" sobre a cobrança mais recente ainda sem resposta
   * (RF-08). `undefined` quando não há cobrança pendente — quem chama
   * decide a resposta honesta (nunca inventa qual item).
   */
  findPendingChargeItemId(): number | undefined {
    return this.deps.chargesRepository.findMostRecentPending()?.itemId;
  }

  /** Marca a cobrança pendente como respondida e registra a amostra de horário em `patterns` (spec item 5) — chamado pelos 3 comandos, sempre. */
  recordResponse(): void {
    const pending = this.deps.chargesRepository.findMostRecentPending();
    if (!pending) return;

    const now = this.now();
    this.deps.chargesRepository.markResponded(pending.id, now);

    this.deps.patternsRepository.recordResponseWindow(zonedWeekday(now), toZonedParts(now).hour);
  }

  /**
   * "2 reagendar" (spec item 1): calcula a proposta (padrão de `patterns` ou
   * fallback de settings) e já APLICA no item — nunca pergunta "para
   * quando?", nunca fica esperando uma segunda confirmação separada.
   */
  async applyReschedule(itemId: number): Promise<string> {
    const samples = this.deps.patternsRepository
      .findRecentResponseWindows(RESPONSE_SAMPLE_WINDOW)
      .map((v) => ({ weekday: v.weekday, hour: v.hour }));

    const proposal = buildRescheduleProposal(
      samples,
      { hour: this.deps.getFallbackSnoozeHour(), minute: this.deps.getFallbackSnoozeMinute() },
      this.now(),
    );

    await this.deps.itemService.snoozeToDate(itemId, new Date(proposal.proposedAt));

    return buildRescheduleMessage(proposal);
  }
}
