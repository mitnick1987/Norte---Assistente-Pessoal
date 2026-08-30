import { describe, expect, it, vi } from 'vitest';
import { buildRitualJobHandlers } from '../../src/modules/rituals/job-handlers.js';
import type { BriefingService } from '../../src/modules/rituals/briefing-service.js';
import type { ReviewService, ReviewPendingDecision } from '../../src/modules/rituals/review-service.js';
import type { OutboxRepository } from '../../src/core/outbox/index.js';
import type { PendingMenuRepository } from '../../src/core/menu/index.js';

const OWNER_JID = '5511999999999@s.whatsapp.net';

function buildDeps(
  overrides: { briefingMessage?: string; reviewMessages?: string[]; pendingDecision?: ReviewPendingDecision } = {},
) {
  const briefingService = {
    buildMessage: vi.fn().mockResolvedValue(overrides.briefingMessage ?? 'bom dia! 3 prioridades hoje...'),
  } as unknown as BriefingService;

  const reviewService = {
    buildMessages: vi.fn().mockResolvedValue({
      messages: overrides.reviewMessages ?? ['fechou X hoje', 'Y foi pra amanhã'],
      pendingDecision: overrides.pendingDecision,
    }),
  } as unknown as ReviewService;

  const outboxRepository = { enqueue: vi.fn() } as unknown as OutboxRepository;
  const pendingMenuRepository = { record: vi.fn(), findMostRecentPending: vi.fn(), markResolved: vi.fn() } as unknown as PendingMenuRepository;

  return { briefingService, reviewService, outboxRepository, pendingMenuRepository };
}

describe('buildRitualJobHandlers (FEAT-006, achado de review: rituais-âncora vs. teto de proativas)', () => {
  it('briefing enfileira com isProactive e isAnchorRitual, nunca isento do teto mas marcado como âncora', async () => {
    const deps = buildDeps();
    const handlers = buildRitualJobHandlers({ ...deps, ownerJid: OWNER_JID });

    await handlers['briefing']!({ jobId: 1, payload: undefined });

    expect(deps.outboxRepository.enqueue).toHaveBeenCalledWith({
      jid: OWNER_JID,
      body: 'bom dia! 3 prioridades hoje...',
      isProactive: true,
      isAnchorRitual: true,
    });
  });

  it('revisão enfileira cada mensagem com isAnchorRitual, mesmo havendo mais de uma', async () => {
    const deps = buildDeps({ reviewMessages: ['fechou X hoje', 'Y foi pra amanhã', 'uma decisão: Z?'] });
    const handlers = buildRitualJobHandlers({ ...deps, ownerJid: OWNER_JID });

    await handlers['revisao']!({ jobId: 2, payload: undefined });

    expect(deps.outboxRepository.enqueue).toHaveBeenCalledTimes(3);
    for (const call of (deps.outboxRepository.enqueue as ReturnType<typeof vi.fn>).mock.calls) {
      expect(call[0]).toMatchObject({ isProactive: true, isAnchorRitual: true });
    }
  });

  /**
   * Achado de review: sem registrar `pending_menus`, o "1"/"2"/"3" de uma
   * decisão de revisão/higiene não tem como ser resolvido contra o item
   * certo — o dígito solto sempre cai no executor de cobrança quando há uma
   * pendente.
   */
  it('revisão com decisão pendente registra em pending_menus a origem e o item certo', async () => {
    const deps = buildDeps({ pendingDecision: { origin: 'revisao', itemId: 42 } });
    const handlers = buildRitualJobHandlers({ ...deps, ownerJid: OWNER_JID });

    await handlers['revisao']!({ jobId: 2, payload: undefined });

    expect(deps.pendingMenuRepository.record).toHaveBeenCalledWith('revisao', 42);
  });

  it('revisão sem decisão pendente não registra nada em pending_menus', async () => {
    const deps = buildDeps();
    const handlers = buildRitualJobHandlers({ ...deps, ownerJid: OWNER_JID });

    await handlers['revisao']!({ jobId: 2, payload: undefined });

    expect(deps.pendingMenuRepository.record).not.toHaveBeenCalled();
  });
});
