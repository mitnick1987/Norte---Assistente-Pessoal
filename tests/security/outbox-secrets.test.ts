import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from '../../src/app.js';
import { buildTestApp, buildTestEnv } from '../factories/test-app.js';
import { jsonResponse, stubFetch } from '../factories/fetch-stub.js';

const WEBHOOK_SECRET = 'a'.repeat(32);
const OWNER_JID = '5511999999999@s.whatsapp.net';
const EVOLUTION_API_KEY = 'chave-evolution-nao-pode-vazar';

function pingPayload(waMessageId: string) {
  return {
    event: 'messages.upsert',
    instance: 'norte-test',
    data: {
      key: { remoteJid: OWNER_JID, id: waMessageId, fromMe: false },
      message: { conversation: 'ping' },
    },
  };
}

/**
 * Captura stdout como os testes S9 de webhook — aqui o alvo é o caminho de
 * saída (outbox → EvolutionClient), não o de entrada. A API key da Evolution
 * viaja no header `apikey` de toda chamada de envio; se um erro de rede
 * algum dia carregar a request/response bruta no `err` logado por
 * OutboxProcessor.handleSendFailure, o redact do pino só protege o que está
 * na allowlist de paths — este teste trava que isso nunca escapa em texto
 * plano, mesmo no caminho de falha.
 */
function captureStdout(): { logs: string[]; restore: () => void } {
  const logs: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- captura raw de stdout só para asserção de log neste teste
  (process.stdout.write as any) = (chunk: string) => {
    logs.push(String(chunk));
    return true;
  };
  return {
    logs,
    restore: () => {
      process.stdout.write = originalWrite;
    },
  };
}

describe('S9: segredos nunca aparecem em log no caminho de envio (outbox)', () => {
  let app: App;

  afterEach(async () => {
    await app.fastify.close();
    app.db.close();
    vi.unstubAllGlobals();
  });

  it('não expõe EVOLUTION_API_KEY no log de warn quando o envio falha e agenda retry', async () => {
    app = buildTestApp({ EVOLUTION_API_KEY });
    stubFetch(() => jsonResponse(500, { error: 'internal' }));

    await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': WEBHOOK_SECRET },
      payload: pingPayload('wa-secret-1'),
    });

    const { logs, restore } = captureStdout();
    try {
      await app.outboxProcessor.processPending();
    } finally {
      restore();
    }

    expect(logs.join('')).not.toContain(EVOLUTION_API_KEY);
  });

  it('não expõe EVOLUTION_API_KEY no log de error quando os retries se esgotam', async () => {
    app = buildTestApp({ EVOLUTION_API_KEY });
    stubFetch(() => jsonResponse(500, { error: 'internal' }));

    await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': WEBHOOK_SECRET },
      payload: pingPayload('wa-secret-2'),
    });

    const { logs, restore } = captureStdout();
    try {
      // esgota attempts manualmente, como outbox-delivery-failure.test.ts (integração).
      const { MAX_ATTEMPTS } = await import('../../src/core/outbox/domain/backoff.js');
      for (let i = 0; i < MAX_ATTEMPTS; i++) {
        app.db.prepare(`UPDATE outbox_messages SET retry_after = NULL WHERE jid = ?`).run(OWNER_JID);
        await app.outboxProcessor.processPending();
      }
    } finally {
      restore();
    }

    expect(logs.join('')).not.toContain(EVOLUTION_API_KEY);
  });

  it('nunca envia a apikey como texto plano fora do header apikey esperado pela Evolution', async () => {
    const env = buildTestEnv({ EVOLUTION_API_KEY });
    app = buildTestApp({ EVOLUTION_API_KEY });
    const { calls } = stubFetch(() => jsonResponse(200, { status: 'success' }));

    await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': WEBHOOK_SECRET },
      payload: pingPayload('wa-secret-3'),
    });

    await app.outboxProcessor.processPending();

    const sendTextCall = calls.find((c) => c.url.includes('/message/sendText/'));
    expect(sendTextCall).toBeDefined();
    // a key só pode estar no header apikey — nunca no corpo da requisição.
    expect(sendTextCall!.init!.body as string).not.toContain(env.EVOLUTION_API_KEY);
    const headers = sendTextCall!.init!.headers as Record<string, string>;
    expect(headers['apikey']).toBe(EVOLUTION_API_KEY);
  });
});
