import { describe, expect, it, vi } from 'vitest';
import { BriefingService, type RemoteAgendaPort } from '../../src/modules/rituals/briefing-service.js';
import { LlmRequestError } from '../../src/core/llm/index.js';
import type { LlmProvider } from '../../src/core/llm/index.js';
import type { ItemService } from '../../src/modules/tasks/public/index.js';
import { createLogger } from '../../src/core/logger.js';

const logger = createLogger('test');

function buildItemServiceStub(items: { id: number; title: string; priority: 1 | 2 | 3 | null; dueAt: string | null }[]): ItemService {
  return { list: vi.fn().mockReturnValue(items) } as unknown as ItemService;
}

function buildProvider(complete: LlmProvider['complete']): LlmProvider {
  return { name: 'stub', complete };
}

/**
 * `BriefingService` orquestra coleta+redação+fallback (spec item 5) — os
 * testes de integração (`rituals-flow.test.ts`) já cobrem o caminho feliz e
 * a falha de API ponta a ponta; aqui isolamos os ramos que dependem de
 * detalhes do stub do provider (resposta vazia, agenda ausente/falha) que
 * são mais baratos e mais claros de expressar sem subir o app inteiro.
 */
describe('BriefingService.buildMessage (spec FEAT-006 item 5)', () => {
  it('Sonnet responde com texto: usa a redação do modelo tal como veio', async () => {
    const complete = vi.fn<LlmProvider['complete']>().mockResolvedValue({
      text: 'Bom dia! Encara revisar contrato primeiro?',
      toolCalls: [],
      usage: { tokensIn: 10, tokensOut: 5, cacheReadTokens: 0 },
    });
    const service = new BriefingService({
      itemService: buildItemServiceStub([{ id: 1, title: 'revisar contrato', priority: 1, dueAt: '2026-08-30T09:00:00.000Z' }]),
      llmProvider: buildProvider(complete),
      systemPrompt: () => 'sys',
      logger,
    });

    const message = await service.buildMessage();

    expect(message).toBe('Bom dia! Encara revisar contrato primeiro?');
  });

  it('Sonnet responde sem texto (string vazia): cai no template de fallback determinístico', async () => {
    const complete = vi.fn<LlmProvider['complete']>().mockResolvedValue({
      text: '',
      toolCalls: [],
      usage: { tokensIn: 10, tokensOut: 0, cacheReadTokens: 0 },
    });
    const service = new BriefingService({
      itemService: buildItemServiceStub([{ id: 1, title: 'pagar boleto', priority: 1, dueAt: '2026-08-30T09:00:00.000Z' }]),
      llmProvider: buildProvider(complete),
      systemPrompt: () => 'sys',
      logger,
    });

    const message = await service.buildMessage();

    expect(message).toContain('pagar boleto');
    expect(message).toContain('Qual você encara primeiro?');
  });

  it('LlmRequestError na chamada ao Sonnet cai no fallback com os mesmos dados coletados (ADR-006)', async () => {
    const complete = vi.fn<LlmProvider['complete']>().mockRejectedValue(new LlmRequestError('timeout'));
    const service = new BriefingService({
      itemService: buildItemServiceStub([{ id: 1, title: 'revisar contrato', priority: 1, dueAt: '2026-08-30T09:00:00.000Z' }]),
      llmProvider: buildProvider(complete),
      systemPrompt: () => 'sys',
      logger,
    });

    const message = await service.buildMessage();

    expect(message).toContain('revisar contrato');
    expect(message).toContain('Qual você encara primeiro?');
  });

  it('erro que não é LlmRequestError propaga — nunca mascarado como falha de API tratável', async () => {
    const complete = vi.fn<LlmProvider['complete']>().mockRejectedValue(new Error('bug de programação'));
    const service = new BriefingService({
      itemService: buildItemServiceStub([]),
      llmProvider: buildProvider(complete),
      systemPrompt: () => 'sys',
      logger,
    });

    await expect(service.buildMessage()).rejects.toThrow('bug de programação');
  });

  it('sem agendaPort (Google nunca autorizado, ADR-019): briefing sai sem seção de agenda, nunca falha por isso', async () => {
    const complete = vi.fn<LlmProvider['complete']>().mockResolvedValue({
      text: 'briefing sem agenda',
      toolCalls: [],
      usage: { tokensIn: 1, tokensOut: 1, cacheReadTokens: 0 },
    });
    const service = new BriefingService({
      itemService: buildItemServiceStub([]),
      llmProvider: buildProvider(complete),
      systemPrompt: () => 'sys',
      logger,
    });

    await expect(service.buildMessage()).resolves.toBe('briefing sem agenda');
    const draftingPrompt = String(complete.mock.calls[0]![0].messages[0]!.content);
    expect(draftingPrompt).toContain('sem compromissos hoje');
  });

  it('agendaPort.listTodayAndSync falha: segue sem a agenda em vez de derrubar o briefing inteiro', async () => {
    const agendaPort: RemoteAgendaPort = { listTodayAndSync: vi.fn().mockRejectedValue(new Error('Google fora do ar')) };
    const complete = vi.fn<LlmProvider['complete']>().mockResolvedValue({
      text: 'briefing sem agenda por falha',
      toolCalls: [],
      usage: { tokensIn: 1, tokensOut: 1, cacheReadTokens: 0 },
    });
    const service = new BriefingService({
      itemService: buildItemServiceStub([]),
      llmProvider: buildProvider(complete),
      systemPrompt: () => 'sys',
      logger,
      agendaPort,
    });

    await expect(service.buildMessage()).resolves.toBe('briefing sem agenda por falha');
  });

  it('agendaPort presente e bem-sucedido: eventos entram no prompt de redação', async () => {
    const agendaPort: RemoteAgendaPort = {
      listTodayAndSync: vi.fn().mockResolvedValue([{ title: 'dentista', startAt: '2026-08-30T13:00:00.000Z' }]),
    };
    const complete = vi.fn<LlmProvider['complete']>().mockResolvedValue({
      text: 'ok',
      toolCalls: [],
      usage: { tokensIn: 1, tokensOut: 1, cacheReadTokens: 0 },
    });
    const service = new BriefingService({
      itemService: buildItemServiceStub([]),
      llmProvider: buildProvider(complete),
      systemPrompt: () => 'sys',
      logger,
      agendaPort,
    });

    await service.buildMessage();

    const draftingPrompt = String(complete.mock.calls[0]![0].messages[0]!.content);
    expect(draftingPrompt).toContain('dentista');
  });

  it('registra usage quando o Sonnet responde com sucesso', async () => {
    const onUsage = vi.fn();
    const complete = vi.fn<LlmProvider['complete']>().mockResolvedValue({
      text: 'ok',
      toolCalls: [],
      usage: { tokensIn: 42, tokensOut: 7, cacheReadTokens: 0 },
    });
    const service = new BriefingService({
      itemService: buildItemServiceStub([]),
      llmProvider: buildProvider(complete),
      systemPrompt: () => 'sys',
      logger,
      onUsage,
    });

    await service.buildMessage();

    expect(onUsage).toHaveBeenCalledWith({ tokensIn: 42, tokensOut: 7, cacheReadTokens: 0 });
  });

  it('chama sempre com cacheSystemPrompt=true (ADR-007)', async () => {
    const complete = vi.fn<LlmProvider['complete']>().mockResolvedValue({
      text: 'ok',
      toolCalls: [],
      usage: { tokensIn: 1, tokensOut: 1, cacheReadTokens: 0 },
    });
    const service = new BriefingService({
      itemService: buildItemServiceStub([]),
      llmProvider: buildProvider(complete),
      systemPrompt: () => 'sys',
      logger,
    });

    await service.buildMessage();

    expect(complete.mock.calls[0]![0].cacheSystemPrompt).toBe(true);
  });
});
