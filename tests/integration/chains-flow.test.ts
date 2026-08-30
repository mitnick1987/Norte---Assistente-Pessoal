import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from '../../src/app.js';
import { buildTestApp } from '../factories/test-app.js';
import { jsonResponse, stubFetch, type FetchCall } from '../factories/fetch-stub.js';
import { anthropicToolUseResponse, anthropicErrorResponse, type StubTriageResult } from '../factories/anthropic-stub.js';

const OWNER_JID = '5511999999999@s.whatsapp.net';

// terça-feira 2026-08-25 10:00 America/Sao_Paulo (13:00 UTC) — sexta 14h resolve para 2026-08-28T17:00:00.000Z UTC.
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

function routedStub(anthropicResult: StubTriageResult | { error: number }) {
  return stubFetch((call: FetchCall) => {
    if (call.url.includes('api.anthropic.com')) {
      if ('error' in anthropicResult) return anthropicErrorResponse(anthropicResult.error);
      return anthropicToolUseResponse(anthropicResult);
    }
    return jsonResponse(200, { status: 'success' });
  });
}

describe('cadeias de lembrete de compromisso (FEAT-004, PRD §6 fluxo 3)', () => {
  let app: App;

  beforeEach(() => {
    app = buildTestApp({}, { now: () => FIXED_NOW });
  });

  afterEach(async () => {
    await app.fastify.close();
    app.db.close();
    vi.unstubAllGlobals();
  });

  it('captura de "dentista sexta 16h" gera item + event + exatamente 3 jobs na cadeia, numa única confirmação de 1 linha', async () => {
    routedStub({
      classification: 'captura',
      items: [{ type: 'compromisso', title: 'dentista', dueExpression: 'sexta 16h' }],
    });

    const response = await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': 'a'.repeat(32) },
      payload: textWebhookPayload('wa-1', 'marca dentista sexta 16h'),
    });
    expect(response.statusCode).toBe(200);

    await app.waitForPendingProcessing();
    await app.outboxProcessor.processPending();

    const item = app.db.prepare('SELECT id, status, due_at FROM items').get() as {
      id: number;
      status: string;
      due_at: string;
    };
    expect(item.status).toBe('ativa');
    // sexta 2026-08-28 16h America/Sao_Paulo = 19h UTC.
    expect(item.due_at).toBe('2026-08-28T19:00:00.000Z');

    const event = app.db.prepare('SELECT item_id, start_at, cadeia_gerada, status FROM events').get() as {
      item_id: number;
      start_at: string;
      cadeia_gerada: number;
      status: string;
    };
    expect(event).toMatchObject({ item_id: item.id, start_at: '2026-08-28T19:00:00.000Z', cadeia_gerada: 1, status: 'ativo' });

    const jobs = app.db.prepare(`SELECT next_run_at FROM jobs WHERE type = 'reminder' ORDER BY next_run_at`).all() as {
      next_run_at: string;
    }[];
    expect(jobs).toHaveLength(3);
    // véspera: quinta 27/08 20h SP = 23h UTC; manhã: sexta 28/08 8h SP = 11h UTC;
    // preparo: 19h - 30min(deslocamento default) - 15min(margem) = 18h15 UTC.
    expect(jobs.map((j) => j.next_run_at)).toEqual([
      '2026-08-27T23:00:00.000Z',
      '2026-08-28T11:00:00.000Z',
      '2026-08-28T18:15:00.000Z',
    ]);

    // confirmação continua de 1 linha, sem menção a "cadeia"/estrutura interna (spec item 5).
    const outboxRow = app.db.prepare('SELECT body FROM outbox_messages WHERE jid = ?').get(OWNER_JID) as
      | { body: string }
      | undefined;
    expect(outboxRow?.body).toBeDefined();
    expect(outboxRow!.body.split('\n')).toHaveLength(1);
    expect(outboxRow!.body).not.toMatch(/\?/);
  });

  it('drop do compromisso ("dropa") cancela os jobs pendentes da cadeia inteira', async () => {
    routedStub({
      classification: 'captura',
      items: [{ type: 'compromisso', title: 'dentista', dueExpression: 'sexta 16h' }],
    });
    await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': 'a'.repeat(32) },
      payload: textWebhookPayload('wa-1', 'marca dentista sexta 16h'),
    });
    await app.waitForPendingProcessing();
    expect(app.db.prepare(`SELECT COUNT(*) as c FROM jobs WHERE status = 'pending'`).get()).toMatchObject({ c: 3 });

    const dropResponse = await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': 'a'.repeat(32) },
      payload: textWebhookPayload('wa-2', 'dropa'),
    });
    expect(dropResponse.statusCode).toBe(200);
    await app.waitForPendingProcessing();

    const item = app.db.prepare('SELECT status FROM items').get() as { status: string };
    expect(item.status).toBe('dropada');

    const event = app.db.prepare('SELECT status FROM events').get() as { status: string };
    expect(event.status).toBe('cancelado');

    expect(app.db.prepare(`SELECT COUNT(*) as c FROM jobs WHERE status = 'pending'`).get()).toMatchObject({ c: 0 });
    const failedCount = app.db.prepare(`SELECT COUNT(*) as c FROM jobs WHERE status = 'failed'`).get() as {
      c: number;
    };
    expect(failedCount.c).toBe(3);
  });

  it('disparo de cada tipo de reminder da cadeia usa o template correto, na ordem véspera->manhã->preparo, sem nenhuma chamada ao LLM', async () => {
    routedStub({
      classification: 'captura',
      items: [{ type: 'compromisso', title: 'dentista', dueExpression: 'sexta 16h' }],
    });
    await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': 'a'.repeat(32) },
      payload: textWebhookPayload('wa-1', 'marca dentista sexta 16h'),
    });
    await app.waitForPendingProcessing();
    await app.outboxProcessor.processPending();

    const { calls } = routedStub({ classification: 'conversa' });

    // avanço de tempo simulado: os 3 jobs da cadeia vencem juntos (mesmo
    // cenário do catch-up após downtime, ADR-004) — a ordem de disparo segue
    // a ordem de criação dos jobs (véspera, manhã, preparo), que é a mesma
    // ordem que `expandChain` produz.
    app.db.prepare(`UPDATE jobs SET next_run_at = '2020-01-01T00:00:00.000Z' WHERE type = 'reminder'`).run();
    await app.scheduler.tick();
    await app.outboxProcessor.processPending();

    const anthropicCalls = calls.filter((c) => c.url.includes('api.anthropic.com'));
    expect(anthropicCalls).toHaveLength(0); // RF-04: disparo da cadeia é 100% sem LLM

    const bodies = app.db
      .prepare(`SELECT body FROM outbox_messages WHERE is_proactive = 1 ORDER BY id`)
      .all()
      .map((r) => (r as { body: string }).body)
      .filter((body) => body.includes('dentista'));

    expect(bodies).toHaveLength(3);
    // ordem de chegada no outbox é véspera -> manhã -> preparo (fluxo 3 do PRD §6).
    expect(bodies[0]).toMatch(/amanh[aã]/i);
    expect(bodies[1]).toMatch(/hoje/i);
    expect(bodies[2]).toMatch(/\d+\s*min/);
    expect(bodies[2]).not.toMatch(/\d{1,2}[:h]\d{2}/);
  });

  it('dueExpression não reconhecida em compromisso não gera event nem cadeia (segue como antes, sem job)', async () => {
    routedStub({
      classification: 'captura',
      items: [{ type: 'compromisso', title: 'dentista', dueExpression: 'lá pelas tantas' }],
    });

    await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': 'a'.repeat(32) },
      payload: textWebhookPayload('wa-1', 'marca dentista lá pelas tantas'),
    });
    await app.waitForPendingProcessing();

    expect(app.db.prepare('SELECT COUNT(*) as c FROM events').get()).toMatchObject({ c: 0 });
    expect(app.db.prepare(`SELECT COUNT(*) as c FROM jobs WHERE type = 'reminder'`).get()).toMatchObject({ c: 0 });
  });
});
