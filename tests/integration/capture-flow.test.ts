import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from '../../src/app.js';
import { buildTestApp } from '../factories/test-app.js';
import { jsonResponse, stubFetch, type FetchCall } from '../factories/fetch-stub.js';
import { anthropicToolUseResponse, anthropicErrorResponse, type StubTriageResult } from '../factories/anthropic-stub.js';

const OWNER_JID = '5511999999999@s.whatsapp.net';

// terça-feira 2026-08-25 10:00 America/Sao_Paulo (13:00 UTC) — mesma referência
// usada em tasks-date-parsing.test.ts; "sexta 14h" resolve para 2026-08-28T17:00:00.000Z UTC.
const FIXED_NOW = new Date('2026-08-25T13:00:00.000Z');

function textWebhookPayload(waMessageId: string, text: string) {
  return {
    event: 'messages.upsert',
    instance: 'norte-test',
    data: {
      key: { remoteJid: OWNER_JID, id: waMessageId, fromMe: false },
      message: { conversation: text },
    },
  };
}

/** Roteia por URL: Anthropic vs. Evolution — as duas passam pelo mesmo fetch global stubado. */
function routedStub(anthropicResult: StubTriageResult | { error: number }) {
  return stubFetch((call: FetchCall) => {
    if (call.url.includes('api.anthropic.com')) {
      if ('error' in anthropicResult) return anthropicErrorResponse(anthropicResult.error);
      return anthropicToolUseResponse(anthropicResult);
    }
    return jsonResponse(200, { status: 'success' });
  });
}

describe('fluxo de captura de texto (FEAT-002, PRD §6 fluxo 5)', () => {
  let app: App;

  beforeEach(() => {
    app = buildTestApp({}, { now: () => FIXED_NOW });
  });

  afterEach(async () => {
    await app.fastify.close();
    app.db.close();
    vi.unstubAllGlobals();
  });

  it('mensagem de texto -> triagem -> item gravado -> confirmação de 1 linha, sem pergunta', async () => {
    routedStub({
      classification: 'captura',
      items: [{ type: 'tarefa', title: 'pagar o boleto', dueExpression: 'sexta 14h' }],
    });

    const response = await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': 'a'.repeat(32) },
      payload: textWebhookPayload('wa-1', 'lembra de pagar o boleto sexta 14h'),
    });

    // ADR-018: o 2xx chega antes de a triagem terminar — o processamento
    // (triagem->captura->confirmação) roda em background.
    expect(response.statusCode).toBe(200);

    await app.waitForPendingProcessing();
    await app.outboxProcessor.processPending();

    const outboxRow = app.db.prepare('SELECT body FROM outbox_messages WHERE jid = ?').get(OWNER_JID) as
      | { body: string }
      | undefined;
    expect(outboxRow?.body).toBeDefined();
    expect(outboxRow!.body).not.toMatch(/\?/);
    expect(outboxRow!.body.split('\n')).toHaveLength(1);

    const item = app.db.prepare('SELECT title, status FROM items').get() as { title: string; status: string };
    expect(item).toMatchObject({ title: 'pagar o boleto', status: 'ativa' });

    // lembrete pontual agendado na tabela jobs (RF-03), sem depender de chains.
    const job = app.db.prepare(`SELECT type, next_run_at FROM jobs WHERE type = 'reminder'`).get() as
      | { type: string; next_run_at: string }
      | undefined;
    expect(job).toMatchObject({ type: 'reminder', next_run_at: '2026-08-28T17:00:00.000Z' });

    const message = app.db.prepare(`SELECT processing_status FROM messages WHERE wa_message_id = 'wa-1'`).get() as {
      processing_status: string;
    };
    expect(message.processing_status).toBe('processed');
  });

  it('dueExpression não reconhecida (ADR-006): item cai em inbox sem job, confirmação avisa sem perguntar', async () => {
    routedStub({
      classification: 'captura',
      items: [{ type: 'compromisso', title: 'dentista', dueExpression: 'lá pelas tantas' }],
    });

    const response = await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': 'a'.repeat(32) },
      payload: textWebhookPayload('wa-1', 'marca dentista lá pelas tantas'),
    });
    expect(response.statusCode).toBe(200);

    await app.waitForPendingProcessing();
    await app.outboxProcessor.processPending();

    const item = app.db.prepare('SELECT title, status, due_at FROM items').get() as {
      title: string;
      status: string;
      due_at: string | null;
    };
    expect(item).toMatchObject({ title: 'dentista', status: 'inbox', due_at: null });

    expect(app.db.prepare(`SELECT COUNT(*) as c FROM jobs WHERE type = 'reminder'`).get()).toMatchObject({ c: 0 });

    const outboxRow = app.db.prepare('SELECT body FROM outbox_messages WHERE jid = ?').get(OWNER_JID) as
      | { body: string }
      | undefined;
    expect(outboxRow?.body).toBeDefined();
    expect(outboxRow!.body).not.toMatch(/\?/);
    expect(outboxRow!.body.split('\n')).toHaveLength(1);
    expect(outboxRow!.body.toLowerCase()).toMatch(/não entendi|não ficou clara/);
  });

  it('"feito" é resolvido pelo executor determinístico, sem acionar a API da Anthropic', async () => {
    const { calls } = routedStub({ classification: 'captura', items: [{ type: 'tarefa', title: 'x' }] });

    // primeiro cria um item via captura (única forma de existir item ativo neste teste).
    await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': 'a'.repeat(32) },
      payload: textWebhookPayload('wa-1', 'anota pagar o boleto'),
    });
    await app.waitForPendingProcessing();

    const anthropicCallsAfterCapture = calls.filter((c) => c.url.includes('api.anthropic.com')).length;
    expect(anthropicCallsAfterCapture).toBe(1);

    const response = await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': 'a'.repeat(32) },
      payload: textWebhookPayload('wa-2', 'feito'),
    });
    expect(response.statusCode).toBe(200);
    await app.waitForPendingProcessing();

    // "feito" não deveria ter chamado a Anthropic de novo (RF-07: comando
    // determinístico resolvido sem tocar o LLM).
    const anthropicCallsAfterFeito = calls.filter((c) => c.url.includes('api.anthropic.com')).length;
    expect(anthropicCallsAfterFeito).toBe(anthropicCallsAfterCapture);

    const item = app.db.prepare('SELECT status FROM items').get() as { status: string };
    expect(item.status).toBe('feita');

    await app.outboxProcessor.processPending();
    const lastMessage = app.db
      .prepare('SELECT body FROM outbox_messages ORDER BY id DESC LIMIT 1')
      .get() as { body: string };
    expect(lastMessage.body).not.toMatch(/adiamento|hist[oó]rico/i);
  });

  it('lembrete pontual dispara por template no horário simulado, sem chamada ao LLM no caminho do disparo', async () => {
    routedStub({
      classification: 'captura',
      items: [{ type: 'compromisso', title: 'dentista', dueExpression: 'sexta 14h' }],
    });

    await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': 'a'.repeat(32) },
      payload: textWebhookPayload('wa-1', 'marca dentista sexta 14h'),
    });
    await app.waitForPendingProcessing();
    await app.outboxProcessor.processPending();

    const { calls } = routedStub({ classification: 'conversa' });

    // avanço de tempo simulado: força o scheduler a considerar o job vencido.
    app.db.prepare(`UPDATE jobs SET next_run_at = '2020-01-01T00:00:00.000Z' WHERE type = 'reminder'`).run();
    await app.scheduler.tick();
    await app.outboxProcessor.processPending();

    const anthropicCalls = calls.filter((c) => c.url.includes('api.anthropic.com'));
    expect(anthropicCalls).toHaveLength(0); // disparo do lembrete é 100% sem LLM (RF-03)

    const reminderMessage = app.db
      .prepare(`SELECT body FROM outbox_messages WHERE body LIKE 'Lembrete:%'`)
      .get() as { body: string } | undefined;
    expect(reminderMessage?.body).toBe('Lembrete: dentista');
  });

  it('registro de tokens: chamada à triagem grava tokens_in/tokens_out/cache_read_tokens em messages', async () => {
    routedStub({
      classification: 'captura',
      items: [{ type: 'nota', title: 'x' }],
      usage: { input_tokens: 200, output_tokens: 60, cache_read_input_tokens: 150 },
    });

    await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': 'a'.repeat(32) },
      payload: textWebhookPayload('wa-1', 'anota uma ideia'),
    });
    await app.waitForPendingProcessing();

    const row = app.db
      .prepare(`SELECT tokens_in, tokens_out, cache_read_tokens FROM messages WHERE intent = 'triagem'`)
      .get() as { tokens_in: number; tokens_out: number; cache_read_tokens: number };
    expect(row).toEqual({ tokens_in: 200, tokens_out: 60, cache_read_tokens: 150 });
  });

  it('falha da API da Anthropic cai em resposta padrão, nunca em silêncio', async () => {
    routedStub({ error: 500 });

    const response = await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': 'a'.repeat(32) },
      payload: textWebhookPayload('wa-1', 'oi, tudo bem?'),
    });
    expect(response.statusCode).toBe(200);
    await app.waitForPendingProcessing();

    await app.outboxProcessor.processPending();
    const outboxRow = app.db.prepare('SELECT body FROM outbox_messages').get() as { body: string } | undefined;
    expect(outboxRow?.body).toBeDefined();

    const message = app.db.prepare(`SELECT processing_status FROM messages WHERE wa_message_id = 'wa-1'`).get() as {
      processing_status: string;
    };
    expect(message.processing_status).toBe('processed');
  });

  it('"me mostra tudo" lista os itens ativos sem adiamentos_count em nenhuma linha', async () => {
    routedStub({ classification: 'captura', items: [{ type: 'tarefa', title: 'pagar boleto' }] });
    await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': 'a'.repeat(32) },
      payload: textWebhookPayload('wa-1', 'anota pagar o boleto'),
    });
    await app.waitForPendingProcessing();

    const response = await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': 'a'.repeat(32) },
      payload: textWebhookPayload('wa-2', 'me mostra tudo'),
    });
    expect(response.statusCode).toBe(200);
    await app.waitForPendingProcessing();

    await app.outboxProcessor.processPending();
    const lastMessage = app.db
      .prepare('SELECT body FROM outbox_messages ORDER BY id DESC LIMIT 1')
      .get() as { body: string };
    expect(lastMessage.body).toContain('pagar boleto');
    expect(lastMessage.body).not.toMatch(/adiamento/i);
  });

  it('ACK responde antes de a triagem (LLM) terminar (ADR-018)', async () => {
    let resolveTriage: (() => void) | undefined;
    const triageGate = new Promise<void>((resolve) => {
      resolveTriage = resolve;
    });

    stubFetch(async (call: FetchCall) => {
      if (call.url.includes('api.anthropic.com')) {
        await triageGate;
        return anthropicToolUseResponse({ classification: 'captura', items: [{ type: 'nota', title: 'x' }] });
      }
      return jsonResponse(200, { status: 'success' });
    });

    const injectPromise = app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': 'a'.repeat(32) },
      payload: textWebhookPayload('wa-1', 'anota uma ideia'),
    });

    const response = await injectPromise;
    expect(response.statusCode).toBe(200);

    // neste ponto a triagem ainda está travada — a mensagem tem que seguir pending.
    const messageDuringProcessing = app.db
      .prepare(`SELECT processing_status FROM messages WHERE wa_message_id = 'wa-1'`)
      .get() as { processing_status: string };
    expect(messageDuringProcessing.processing_status).toBe('pending');

    resolveTriage!();
    await app.waitForPendingProcessing();

    const messageAfterProcessing = app.db
      .prepare(`SELECT processing_status FROM messages WHERE wa_message_id = 'wa-1'`)
      .get() as { processing_status: string };
    expect(messageAfterProcessing.processing_status).toBe('processed');
  });
});
