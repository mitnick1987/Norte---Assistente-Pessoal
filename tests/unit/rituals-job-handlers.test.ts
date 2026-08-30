import { describe, expect, it, vi } from 'vitest';
import { buildRitualJobHandlers } from '../../src/modules/rituals/job-handlers.js';
import type { BriefingService } from '../../src/modules/rituals/briefing-service.js';
import type { ReviewService } from '../../src/modules/rituals/review-service.js';
import type { OutboxRepository } from '../../src/core/outbox/index.js';

const OWNER_JID = '5511999999999@s.whatsapp.net';

function buildDeps(overrides: { briefingMessage?: string; reviewMessages?: string[] } = {}) {
  const briefingService = {
    buildMessage: vi.fn().mockResolvedValue(overrides.briefingMessage ?? 'bom dia! 3 prioridades hoje...'),
  } as unknown as BriefingService;

  const reviewService = {
    buildMessages: vi.fn().mockResolvedValue(overrides.reviewMessages ?? ['fechou X hoje', 'Y foi pra amanhã']),
  } as unknown as ReviewService;

  const outboxRepository = { enqueue: vi.fn() } as unknown as OutboxRepository;

  return { briefingService, reviewService, outboxRepository };
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
});
