import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from '../../src/app.js';
import { buildTestApp } from '../factories/test-app.js';
import { jsonResponse, stubFetch } from '../factories/fetch-stub.js';

const WEBHOOK_SECRET = 'a'.repeat(32);
const OWNER_JID = '5511999999999@s.whatsapp.net';
const INSTANCE = 'norte-test';

function textMessagePayload(overrides: {
  jid?: string;
  waMessageId?: string;
  text?: string;
  instance?: string;
  fromMe?: boolean;
}) {
  return {
    event: 'messages.upsert',
    instance: overrides.instance ?? INSTANCE,
    data: {
      key: {
        remoteJid: overrides.jid ?? OWNER_JID,
        id: overrides.waMessageId ?? 'wa-1',
        fromMe: overrides.fromMe ?? false,
      },
      message: { conversation: overrides.text ?? 'ping' },
    },
  };
}

function outboxCount(app: App): number {
  const row = app.db.prepare('SELECT COUNT(*) as c FROM outbox_messages').get() as { c: number };
  return row.c;
}

function messagesCount(app: App): number {
  const row = app.db.prepare('SELECT COUNT(*) as c FROM messages').get() as { c: number };
  return row.c;
}

describe('suite de segurança/isolamento do webhook (TESTING.md §3)', () => {
  let app: App;

  beforeEach(() => {
    app = buildTestApp();
    stubFetch(() => jsonResponse(200, { status: 'success' }));
  });

  afterEach(async () => {
    await app.fastify.close();
    app.db.close();
    vi.unstubAllGlobals();
  });

  it('S1: webhook sem o segredo configurado é rejeitado antes de qualquer processamento', async () => {
    const response = await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      payload: textMessagePayload({}),
    });

    expect(response.statusCode).toBe(401);
    expect(outboxCount(app)).toBe(0);
    expect(messagesCount(app)).toBe(0);
  });

  it('S1: webhook com segredo errado é rejeitado', async () => {
    const response = await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': 'segredo-errado-000000000000000' },
      payload: textMessagePayload({}),
    });

    expect(response.statusCode).toBe(401);
  });

  it('S1: aceita o segredo via query string (fallback do provisionamento real na Evolution 2.3.7)', async () => {
    const response = await app.fastify.inject({
      method: 'POST',
      url: `/webhook/evolution?secret=${WEBHOOK_SECRET}`,
      payload: textMessagePayload({}),
    });

    expect(response.statusCode).toBe(200);
  });

  it('S1: segredo errado na query string é rejeitado', async () => {
    const response = await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution?secret=segredo-errado-000000000000000',
      payload: textMessagePayload({}),
    });

    expect(response.statusCode).toBe(401);
  });

  it('S2: webhook de instância Evolution diferente é ignorado, nenhum efeito no task-store', async () => {
    const response = await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': WEBHOOK_SECRET },
      payload: textMessagePayload({ instance: 'outra-instancia' }),
    });

    expect(response.statusCode).toBe(200);
    expect(messagesCount(app)).toBe(0);
  });

  it('S6: payload sem os campos mínimos do contrato é rejeitado, processo não cai', async () => {
    const response = await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': WEBHOOK_SECRET },
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(messagesCount(app)).toBe(0);

    // processo segue respondendo normalmente depois do payload malformado.
    const healthResponse = await app.fastify.inject({ method: 'GET', url: '/health' });
    expect(healthResponse.statusCode).toBe(200);
  });

  it('S7: webhook com JID diferente do dono é ignorado e logado, nenhum item criado, nenhuma resposta enviada', async () => {
    const { calls } = stubFetch(() => jsonResponse(200));

    const response = await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': WEBHOOK_SECRET },
      payload: textMessagePayload({ jid: '5511000000000@s.whatsapp.net' }),
    });

    expect(response.statusCode).toBe(200);
    expect(messagesCount(app)).toBe(0);
    expect(outboxCount(app)).toBe(0);

    await app.outboxProcessor.processPending();
    expect(calls.some((c) => c.url.includes('/message/sendText/'))).toBe(false);
  });

  it('S8: reentrega do mesmo wa_message_id não duplica item nem mensagem de saída', async () => {
    const payload = textMessagePayload({ waMessageId: 'wa-dedup-1' });

    const first = await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': WEBHOOK_SECRET },
      payload,
    });
    const second = await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': WEBHOOK_SECRET },
      payload,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(JSON.parse(second.body)).toMatchObject({ deduped: true });

    // 1 mensagem de entrada (dedup) + 1 registro de uso da triagem (RF-15) —
    // a segunda entrega é bloqueada pelo dedup antes de chegar à triagem, e
    // por isso não soma mais nenhuma linha em nenhuma das duas tabelas.
    expect(messagesCount(app)).toBe(2);
    expect(outboxCount(app)).toBe(1);
  });

  it('S8b: mensagem sem key.id (dedup impossível) é rejeitada, nunca processada', async () => {
    const { calls } = stubFetch(() => jsonResponse(200));
    // key.id ausente: schema permite (campo opcional), mas o dedup não teria
    // como funcionar — precisa ser recusado antes do dispatch.
    const payload = {
      event: 'messages.upsert',
      instance: INSTANCE,
      data: {
        key: { remoteJid: OWNER_JID, fromMe: false },
        message: { conversation: 'ping' },
      },
    };

    const response = await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': WEBHOOK_SECRET },
      payload,
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ ignored: true });
    expect(messagesCount(app)).toBe(0);
    expect(outboxCount(app)).toBe(0);

    await app.outboxProcessor.processPending();
    expect(calls.some((c) => c.url.includes('/message/sendText/'))).toBe(false);
  });

  it('S9: logger nunca expõe o segredo do webhook em texto plano', async () => {
    const logs: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- captura raw de stdout só para asserção de log neste teste
    (process.stdout.write as any) = (chunk: string) => {
      logs.push(String(chunk));
      return true;
    };

    try {
      await app.fastify.inject({
        method: 'POST',
        url: '/webhook/evolution',
        headers: { 'x-webhook-secret': 'valor-que-nao-pode-vazar-em-log' },
        payload: textMessagePayload({}),
      });
    } finally {
      process.stdout.write = originalWrite;
    }

    const joined = logs.join('');
    expect(joined).not.toContain('valor-que-nao-pode-vazar-em-log');
  });

  it('S9: log de acesso do Fastify não vaza o segredo quando ele chega via query string', async () => {
    // NODE_ENV=test silencia o pino (buildTestApp) — esse cenário só se
    // manifesta com o nível de log real de produção, então sobe uma
    // instância dedicada em vez de reusar o `app` padrão da suite.
    const { buildApp } = await import('../../src/app.js');
    const { buildTestEnv } = await import('../factories/test-app.js');
    const prodLikeApp = buildApp(buildTestEnv({ NODE_ENV: 'production' }), {
      outboxSleep: async () => undefined,
      provisionWebhook: false,
    });

    const logs: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- captura raw de stdout só para asserção de log neste teste
    (process.stdout.write as any) = (chunk: string) => {
      logs.push(String(chunk));
      return true;
    };

    try {
      await prodLikeApp.fastify.inject({
        method: 'POST',
        url: `/webhook/evolution?secret=${WEBHOOK_SECRET}`,
        payload: textMessagePayload({}),
      });
    } finally {
      process.stdout.write = originalWrite;
      await prodLikeApp.fastify.close();
      prodLikeApp.db.close();
    }

    const joined = logs.join('');
    expect(joined).not.toContain(WEBHOOK_SECRET);
    expect(joined).toContain('/webhook/evolution');
  });

  it('S10: payload de webhook malformado (tipo errado) é rejeitado com erro controlado', async () => {
    const response = await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': WEBHOOK_SECRET },
      payload: { event: 'messages.upsert', instance: 123, data: 'não é um objeto' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('S10: corpo com JSON inválido não derruba o processo', async () => {
    const response = await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': WEBHOOK_SECRET, 'content-type': 'application/json' },
      payload: '{ isso não é json',
    });

    expect(response.statusCode).toBe(400);

    const healthResponse = await app.fastify.inject({ method: 'GET', url: '/health' });
    expect(healthResponse.statusCode).toBe(200);
  });

  it('S10 (FEAT-003): payload de audioMessage com tipo inesperado é rejeitado pela validação zod, processo não cai', async () => {
    const response = await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': WEBHOOK_SECRET },
      payload: {
        event: 'messages.upsert',
        instance: INSTANCE,
        data: {
          key: { remoteJid: OWNER_JID, id: 'wa-audio-malformado', fromMe: false },
          // seconds deveria ser number — string quebra o contrato do protobuf.
          message: { audioMessage: { seconds: 'nao-e-numero' } },
        },
      },
    });

    expect(response.statusCode).toBe(400);
    expect(messagesCount(app)).toBe(0);

    const healthResponse = await app.fastify.inject({ method: 'GET', url: '/health' });
    expect(healthResponse.statusCode).toBe(200);
  });

  it('FEAT-003: busca de mídia nunca usa base64 do payload do webhook, mesmo quando presente (SECURITY.md §6)', async () => {
    const { calls } = stubFetch((call) => {
      if (call.url.includes('getBase64FromMediaMessage')) return jsonResponse(200, { base64: 'BUSCADO-ATIVAMENTE' });
      return jsonResponse(200, { status: 'success' });
    });

    // payload traz um campo base64 dentro de audioMessage — o schema aceita
    // (passthrough) mas o adapter nunca deveria ler esse valor.
    const response = await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': WEBHOOK_SECRET },
      payload: {
        event: 'messages.upsert',
        instance: INSTANCE,
        data: {
          key: { remoteJid: OWNER_JID, id: 'wa-audio-base64-payload', fromMe: false },
          message: { audioMessage: { mimetype: 'audio/ogg', base64: 'BASE64-DO-PAYLOAD-NAO-CONFIAVEL' } },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    await app.waitForPendingProcessing();

    const mediaCall = calls.find((c) => c.url.includes('getBase64FromMediaMessage'));
    expect(mediaCall).toBeDefined();
    expect(mediaCall!.init!.body as string).not.toContain('BASE64-DO-PAYLOAD-NAO-CONFIAVEL');
  });
});
