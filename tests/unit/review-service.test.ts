import { describe, expect, it, vi } from 'vitest';
import { ReviewService } from '../../src/modules/rituals/review-service.js';
import { REVIEW_MAX_MESSAGES } from '../../src/modules/rituals/domain/index.js';
import { LlmRequestError } from '../../src/core/llm/index.js';
import type { LlmProvider } from '../../src/core/llm/index.js';
import type { ItemService } from '../../src/modules/tasks/public/index.js';
import { createLogger } from '../../src/core/logger.js';

const logger = createLogger('test');
const FIXED_NOW = new Date('2026-08-30T23:00:00.000Z'); // 20h America/Sao_Paulo

function buildItemServiceStub(overrides: {
  completedToday?: { title: string }[];
  rescheduledToTomorrow?: { title: string; dueAt: string }[];
  eligibleForDecision?: { id: number; title: string; dueAt: string }[];
} = {}): ItemService {
  const listByStatusUpdatedBetween = vi.fn((status: string) => {
    if (status === 'feita') return overrides.completedToday ?? [];
    if (status === 'adiada') return overrides.rescheduledToTomorrow ?? [];
    return [];
  });
  const list = vi.fn().mockReturnValue(
    (overrides.eligibleForDecision ?? []).map((i) => ({ ...i, priority: null })),
  );
  return { listByStatusUpdatedBetween, list } as unknown as ItemService;
}

function buildProvider(complete: LlmProvider['complete']): LlmProvider {
  return { name: 'stub', complete };
}

/**
 * `ReviewService` (spec item 6): mesmo esqueleto do briefing — testes de
 * integração cobrem o caminho feliz e a falha de API contra o app inteiro;
 * aqui isolamos os ramos de segmentação da redação livre do Sonnet (que só
 * fazem sentido testar diretamente contra o service, sem subir o Fastify).
 */
describe('ReviewService.buildMessages (spec FEAT-006 item 6)', () => {
  it('Sonnet responde com parágrafos separados por linha em branco: cada parágrafo vira uma mensagem', async () => {
    const complete = vi.fn<LlmProvider['complete']>().mockResolvedValue({
      text: 'Fechou bem hoje.\n\nAmanhã segue tranquilo.\n\nSobre a academia: manter ou dropar?',
      toolCalls: [],
      usage: { tokensIn: 1, tokensOut: 1, cacheReadTokens: 0 },
    });
    const service = new ReviewService({
      itemService: buildItemServiceStub(),
      llmProvider: buildProvider(complete),
      systemPrompt: () => 'sys',
      logger,
      now: () => FIXED_NOW,
    });

    const messages = await service.buildMessages();

    expect(messages).toEqual(['Fechou bem hoje.', 'Amanhã segue tranquilo.', 'Sobre a academia: manter ou dropar?']);
  });

  it('Sonnet devolve mais parágrafos que o teto: trunca em REVIEW_MAX_MESSAGES, nunca excede (imposto no código, não só no prompt)', async () => {
    const complete = vi.fn<LlmProvider['complete']>().mockResolvedValue({
      text: 'um.\n\ndois.\n\ntrês.\n\nquatro.\n\ncinco.',
      toolCalls: [],
      usage: { tokensIn: 1, tokensOut: 1, cacheReadTokens: 0 },
    });
    const service = new ReviewService({
      itemService: buildItemServiceStub(),
      llmProvider: buildProvider(complete),
      systemPrompt: () => 'sys',
      logger,
      now: () => FIXED_NOW,
    });

    const messages = await service.buildMessages();

    expect(messages).toHaveLength(REVIEW_MAX_MESSAGES);
    expect(messages).toEqual(['um.', 'dois.', 'três.']);
  });

  it('Sonnet responde só com texto vazio/quebras de linha: sem parágrafo nenhum sobrevive à segmentação, cai no fallback', async () => {
    const complete = vi.fn<LlmProvider['complete']>().mockResolvedValue({
      text: '\n\n   \n\n',
      toolCalls: [],
      usage: { tokensIn: 1, tokensOut: 1, cacheReadTokens: 0 },
    });
    const service = new ReviewService({
      itemService: buildItemServiceStub({ completedToday: [{ title: 'academia' }] }),
      llmProvider: buildProvider(complete),
      systemPrompt: () => 'sys',
      logger,
      now: () => FIXED_NOW,
    });

    const messages = await service.buildMessages();

    expect(messages.length).toBeGreaterThan(0);
    expect(messages.join(' ')).toContain('academia');
  });

  it('Sonnet responde com string vazia: cai no fallback determinístico', async () => {
    const complete = vi.fn<LlmProvider['complete']>().mockResolvedValue({
      text: '',
      toolCalls: [],
      usage: { tokensIn: 1, tokensOut: 0, cacheReadTokens: 0 },
    });
    const service = new ReviewService({
      itemService: buildItemServiceStub({ completedToday: [{ title: 'relatório' }] }),
      llmProvider: buildProvider(complete),
      systemPrompt: () => 'sys',
      logger,
      now: () => FIXED_NOW,
    });

    const messages = await service.buildMessages();

    expect(messages.join(' ')).toContain('relatório');
  });

  it('LlmRequestError cai no fallback com os mesmos dados coletados (ADR-006)', async () => {
    const complete = vi.fn<LlmProvider['complete']>().mockRejectedValue(new LlmRequestError('erro simulado'));
    const service = new ReviewService({
      itemService: buildItemServiceStub({
        completedToday: [{ title: 'academia' }],
        eligibleForDecision: [{ id: 1, title: 'projeto parado', dueAt: '2026-08-01T09:00:00.000Z' }],
      }),
      llmProvider: buildProvider(complete),
      systemPrompt: () => 'sys',
      logger,
      now: () => FIXED_NOW,
    });

    const messages = await service.buildMessages();

    expect(messages.length).toBeGreaterThan(0);
    expect(messages.length).toBeLessThanOrEqual(REVIEW_MAX_MESSAGES);
    expect(messages.join(' ')).toContain('academia');
  });

  it('erro que não é LlmRequestError propaga — nunca mascarado como falha de API tratável', async () => {
    const complete = vi.fn<LlmProvider['complete']>().mockRejectedValue(new Error('bug de programação'));
    const service = new ReviewService({
      itemService: buildItemServiceStub(),
      llmProvider: buildProvider(complete),
      systemPrompt: () => 'sys',
      logger,
      now: () => FIXED_NOW,
    });

    await expect(service.buildMessages()).rejects.toThrow('bug de programação');
  });

  it('rescheduledToTomorrow só inclui itens cujo novo dueAt cai efetivamente amanhã (fronteira de dia, TZ America/Sao_Paulo)', async () => {
    const complete = vi.fn<LlmProvider['complete']>().mockResolvedValue({
      text: 'ok',
      toolCalls: [],
      usage: { tokensIn: 1, tokensOut: 1, cacheReadTokens: 0 },
    });
    const itemService = buildItemServiceStub();
    // sobrescreve o stub genérico para simular um item "adiada" cujo dueAt
    // cai depois de amanhã (não deveria entrar na seção "fica para amanhã").
    itemService.listByStatusUpdatedBetween = vi.fn((status: string) => {
      if (status === 'adiada') {
        return [
          { title: 'reagendado bem longe', dueAt: '2026-09-05T09:00:00.000Z' },
          { title: 'reagendado para amanhã', dueAt: '2026-08-31T09:00:00.000Z' },
        ];
      }
      return [];
    }) as unknown as ItemService['listByStatusUpdatedBetween'];

    const service = new ReviewService({
      itemService,
      llmProvider: buildProvider(complete),
      systemPrompt: () => 'sys',
      logger,
      now: () => FIXED_NOW,
    });

    await service.buildMessages();

    const draftingPrompt = String(complete.mock.calls[0]![0].messages[0]!.content);
    expect(draftingPrompt).toContain('reagendado para amanhã');
    expect(draftingPrompt).not.toContain('reagendado bem longe');
  });

  it('registra usage quando o Sonnet responde com sucesso', async () => {
    const onUsage = vi.fn();
    const complete = vi.fn<LlmProvider['complete']>().mockResolvedValue({
      text: 'ok',
      toolCalls: [],
      usage: { tokensIn: 12, tokensOut: 3, cacheReadTokens: 0 },
    });
    const service = new ReviewService({
      itemService: buildItemServiceStub(),
      llmProvider: buildProvider(complete),
      systemPrompt: () => 'sys',
      logger,
      onUsage,
      now: () => FIXED_NOW,
    });

    await service.buildMessages();

    expect(onUsage).toHaveBeenCalledWith({ tokensIn: 12, tokensOut: 3, cacheReadTokens: 0 });
  });

  it('chama sempre com cacheSystemPrompt=true (ADR-007)', async () => {
    const complete = vi.fn<LlmProvider['complete']>().mockResolvedValue({
      text: 'ok',
      toolCalls: [],
      usage: { tokensIn: 1, tokensOut: 1, cacheReadTokens: 0 },
    });
    const service = new ReviewService({
      itemService: buildItemServiceStub(),
      llmProvider: buildProvider(complete),
      systemPrompt: () => 'sys',
      logger,
      now: () => FIXED_NOW,
    });

    await service.buildMessages();

    expect(complete.mock.calls[0]![0].cacheSystemPrompt).toBe(true);
  });
});
