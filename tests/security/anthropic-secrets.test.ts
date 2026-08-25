import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from '../../src/app.js';
import { buildTestApp } from '../factories/test-app.js';
import { stubFetch } from '../factories/fetch-stub.js';
import { anthropicErrorResponse } from '../factories/anthropic-stub.js';

const WEBHOOK_SECRET = 'a'.repeat(32);
const OWNER_JID = '5511999999999@s.whatsapp.net';
const ANTHROPIC_API_KEY = 'chave-anthropic-nao-pode-vazar';

function textPayload(waMessageId: string, text: string) {
  return {
    event: 'messages.upsert',
    instance: 'norte-test',
    data: {
      key: { remoteJid: OWNER_JID, id: waMessageId, fromMe: false },
      message: { conversation: text },
    },
  };
}

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

/**
 * Extensão de S9 (TESTING.md §3, FEAT-002): ANTHROPIC_API_KEY nunca aparece
 * em log, nem quando a chamada à Anthropic falha e o erro é logado.
 */
describe('S9 (extensão FEAT-002): ANTHROPIC_API_KEY nunca aparece em log', () => {
  let app: App;

  afterEach(async () => {
    await app.fastify.close();
    app.db.close();
    vi.unstubAllGlobals();
  });

  it('não expõe ANTHROPIC_API_KEY no log de erro quando a chamada à triagem falha', async () => {
    app = buildTestApp({ ANTHROPIC_API_KEY });
    stubFetch((call) => {
      if (call.url.includes('api.anthropic.com')) return anthropicErrorResponse(500, 'internal error');
      return new Response(JSON.stringify({ status: 'success' }), { status: 200 });
    });

    const { logs, restore } = captureStdout();
    try {
      await app.fastify.inject({
        method: 'POST',
        url: '/webhook/evolution',
        headers: { 'x-webhook-secret': WEBHOOK_SECRET },
        payload: textPayload('wa-anthropic-1', 'oi, tudo bem?'),
      });
    } finally {
      restore();
    }

    expect(logs.join('')).not.toContain(ANTHROPIC_API_KEY);
  });

  it('nunca envia a api key como texto plano fora do header x-api-key esperado pela Anthropic', async () => {
    app = buildTestApp({ ANTHROPIC_API_KEY });
    const { calls } = stubFetch((call) => {
      if (call.url.includes('api.anthropic.com')) {
        return new Response(
          JSON.stringify({ content: [], usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 } }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ status: 'success' }), { status: 200 });
    });

    await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': WEBHOOK_SECRET },
      payload: textPayload('wa-anthropic-2', 'oi, tudo bem?'),
    });

    const anthropicCall = calls.find((c) => c.url.includes('api.anthropic.com'));
    expect(anthropicCall).toBeDefined();
    expect(anthropicCall!.init!.body as string).not.toContain(ANTHROPIC_API_KEY);
    const headers = anthropicCall!.init!.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe(ANTHROPIC_API_KEY);
  });
});
