import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from '../../src/app.js';
import { buildTestApp } from '../factories/test-app.js';
import { jsonResponse, stubFetch, type FetchCall } from '../factories/fetch-stub.js';
import { anthropicToolUseResponse, anthropicBrainToolUseResponse, anthropicTextResponse } from '../factories/anthropic-stub.js';

const WEBHOOK_SECRET = 'a'.repeat(32);
const OWNER_JID = '5511999999999@s.whatsapp.net';

function textPayload(waMessageId: string, text: string) {
  return {
    event: 'messages.upsert',
    instance: 'norte-test',
    data: { key: { remoteJid: OWNER_JID, id: waMessageId, fromMe: false }, message: { conversation: text } },
  };
}

/**
 * Extensão de S4 (TESTING.md §3) e das áreas sensíveis da spec FEAT-006
 * (Impacto técnico): o loop de tool-use é uma superfície nova de execução de
 * código a partir de decisão do modelo — nenhuma tool fora do registry
 * explícito pode ser alcançada, e erro de validação nunca vaza detalhe
 * interno (stack trace, nome de tabela/coluna) na resposta que chega ao
 * outbox e, dali, ao usuário.
 */
describe('S4 estendido (FEAT-006): loop de tool-use do brain nunca vaza detalhe interno', () => {
  let app: App;

  afterEach(async () => {
    await app.fastify.close();
    app.db.close();
    vi.unstubAllGlobals();
  });

  it('tool chamada pelo nome de uma tabela/coluna interna (fora do registry) nunca chega a um handler nem vaza no texto final', async () => {
    app = buildTestApp({});

    let call = 0;
    stubFetch((c: FetchCall) => {
      if (!c.url.includes('api.anthropic.com')) return jsonResponse(200, { status: 'success' });
      call++;
      if (call === 1) return anthropicToolUseResponse({ classification: 'conversa' });
      if (call === 2) {
        return anthropicBrainToolUseResponse([
          { id: 'tc_1', name: 'drop_items_table', input: { sql: 'DROP TABLE items' } },
        ]);
      }
      return anthropicTextResponse('não consegui fazer isso agora.');
    });

    await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': WEBHOOK_SECRET },
      payload: textPayload('wa-1', 'apaga tudo do banco'),
    });
    await app.waitForPendingProcessing();

    // a tabela items continua existindo e vazia — nenhuma tool "escondida" executou nada.
    const tables = app.db.prepare<[], { name: string }>(`SELECT name FROM sqlite_master WHERE type='table'`).all();
    expect(tables.map((t) => t.name)).toContain('items');

    const outboxRow = app.db.prepare(`SELECT body FROM outbox_messages ORDER BY id DESC LIMIT 1`).get() as { body: string };
    expect(outboxRow.body).not.toMatch(/DROP TABLE|drop_items_table|SQLITE|sqlite_master/i);
  });

  it('o brain só recebe exatamente as 6 tools declaradas (5 de tasks + create_event) — nenhuma "escondida"', async () => {
    app = buildTestApp({});

    let call = 0;
    const { calls } = stubFetch((c: FetchCall) => {
      if (!c.url.includes('api.anthropic.com')) return jsonResponse(200, { status: 'success' });
      call++;
      if (call === 1) return anthropicToolUseResponse({ classification: 'conversa' });
      return anthropicTextResponse('oi');
    });

    await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': WEBHOOK_SECRET },
      payload: textPayload('wa-tools-1', 'oi, tudo bem?'),
    });
    await app.waitForPendingProcessing();

    const brainCall = calls.filter((c) => c.url.includes('api.anthropic.com'))[1];
    expect(brainCall).toBeDefined();
    const body = JSON.parse(String(brainCall!.init!.body)) as { tools?: { name: string }[] };
    const toolNames = (body.tools ?? []).map((t) => t.name).sort();

    // sem GOOGLE_CLIENT_ID/etc no env de teste, o módulo google-calendar não
    // nasce (spec item 5 da FEAT-005) — só as 5 tools de tasks ficam
    // disponíveis; o teste seguinte cobre o cenário com create_event incluída.
    expect(toolNames).toEqual(['complete_item', 'create_item', 'drop_item', 'list_items', 'snooze_item']);
  });

  it('com o módulo google-calendar ativo, o brain recebe também create_event — nunca mais que as 6 tools declaradas', async () => {
    app = buildTestApp({
      GOOGLE_CLIENT_ID: 'client-id',
      GOOGLE_CLIENT_SECRET: 'client-secret',
      GOOGLE_REDIRECT_URI: 'http://localhost/callback',
      TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    });

    let call = 0;
    const { calls } = stubFetch((c: FetchCall) => {
      if (!c.url.includes('api.anthropic.com')) return jsonResponse(200, { status: 'success' });
      call++;
      if (call === 1) return anthropicToolUseResponse({ classification: 'conversa' });
      return anthropicTextResponse('oi');
    });

    await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': WEBHOOK_SECRET },
      payload: textPayload('wa-tools-2', 'oi, tudo bem?'),
    });
    await app.waitForPendingProcessing();

    const brainCall = calls.filter((c) => c.url.includes('api.anthropic.com'))[1];
    const body = JSON.parse(String(brainCall!.init!.body)) as { tools?: { name: string }[] };
    const toolNames = (body.tools ?? []).map((t) => t.name).sort();

    expect(toolNames).toEqual(['complete_item', 'create_event', 'create_item', 'drop_item', 'list_items', 'snooze_item']);
  });

  it('input de create_item que falha a validação zod nunca vaza o erro cru na resposta final ao usuário', async () => {
    app = buildTestApp({});

    let call = 0;
    stubFetch((c: FetchCall) => {
      if (!c.url.includes('api.anthropic.com')) return jsonResponse(200, { status: 'success' });
      call++;
      if (call === 1) return anthropicToolUseResponse({ classification: 'conversa' });
      if (call === 2) {
        // "type" fora do enum aceito pelo schema strict de create_item.
        return anthropicBrainToolUseResponse([
          { id: 'tc_1', name: 'create_item', input: { type: 'tipo_inventado', title: 'x', origin: 'texto' } },
        ]);
      }
      return anthropicTextResponse('não consegui anotar isso do jeito que você pediu.');
    });

    await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': WEBHOOK_SECRET },
      payload: textPayload('wa-2', 'anota uma coisa esquisita'),
    });
    await app.waitForPendingProcessing();

    const outboxRow = app.db.prepare(`SELECT body FROM outbox_messages ORDER BY id DESC LIMIT 1`).get() as { body: string };
    expect(outboxRow.body).not.toMatch(/ZodError|zod|invalid_enum_value|stack|at Object/i);

    const itemCount = app.db.prepare(`SELECT COUNT(*) as c FROM items`).get() as { c: number };
    expect(itemCount.c).toBe(0);
  });

  it('erro de handler da tool create_event (ex.: falha de rede simulada) nunca vaza detalhe interno na resposta final', async () => {
    app = buildTestApp({
      GOOGLE_CLIENT_ID: 'client-id',
      GOOGLE_CLIENT_SECRET: 'client-secret',
      GOOGLE_REDIRECT_URI: 'http://localhost/callback',
      TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    });

    let call = 0;
    stubFetch((c: FetchCall) => {
      if (!c.url.includes('api.anthropic.com')) return jsonResponse(200, { status: 'success' });
      call++;
      if (call === 1) return anthropicToolUseResponse({ classification: 'conversa' });
      if (call === 2) {
        return anthropicBrainToolUseResponse([
          {
            id: 'tc_1',
            name: 'create_event',
            input: { title: 'Reunião', startAt: '2026-09-04T13:00:00.000Z', endAt: '2026-09-04T14:00:00.000Z' },
          },
        ]);
      }
      return anthropicTextResponse('não consegui marcar no Calendar agora, mas anotei.');
    });

    // Sem token OAuth armazenado (AuthTokenNotFoundError) — cenário realista de falha do lado do Google.
    await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': WEBHOOK_SECRET },
      payload: textPayload('wa-3', 'marca reunião amanhã 10h'),
    });
    await app.waitForPendingProcessing();

    const outboxRow = app.db.prepare(`SELECT body FROM outbox_messages ORDER BY id DESC LIMIT 1`).get() as { body: string };
    expect(outboxRow.body).not.toMatch(/AuthTokenNotFoundError|auth_tokens|refresh_token|stack|at Object/i);
  });
});
