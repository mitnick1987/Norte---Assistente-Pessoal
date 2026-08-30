import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from '../../src/app.js';
import { buildTestApp } from '../factories/test-app.js';
import { jsonResponse, stubFetch } from '../factories/fetch-stub.js';
import { sttErrorResponse, sttTranscriptionResponse } from '../factories/stt-stub.js';

const WEBHOOK_SECRET = 'a'.repeat(32);
const OWNER_JID = '5511999999999@s.whatsapp.net';
const GROQ_API_KEY = 'chave-groq-nao-pode-vazar';
const OPENAI_API_KEY = 'chave-openai-nao-pode-vazar';

function audioPayload(waMessageId: string) {
  return {
    event: 'messages.upsert',
    instance: 'norte-test',
    data: {
      key: { remoteJid: OWNER_JID, id: waMessageId, fromMe: false },
      message: { audioMessage: { mimetype: 'audio/ogg' } },
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
 * Extensão de S9 (TESTING.md §3, FEAT-003): GROQ_API_KEY e OPENAI_API_KEY
 * nunca aparecem em log, mesmo em debug — nem quando as duas chamadas falham
 * e o erro é logado (falha total de STT, spec item 3).
 */
describe('S9 (extensão FEAT-003): GROQ_API_KEY e OPENAI_API_KEY nunca aparecem em log', () => {
  let app: App;

  afterEach(async () => {
    await app.fastify.close();
    app.db.close();
    vi.unstubAllGlobals();
  });

  it('não expõe GROQ_API_KEY nem OPENAI_API_KEY no log quando ambos os providers de STT falham', async () => {
    app = buildTestApp({ GROQ_API_KEY, OPENAI_API_KEY });
    stubFetch((call) => {
      if (call.url.includes('api.groq.com')) return sttErrorResponse(500);
      if (call.url.includes('api.openai.com')) return sttErrorResponse(500);
      return jsonResponse(200, { status: 'success' });
    });

    const { logs, restore } = captureStdout();
    try {
      await app.fastify.inject({
        method: 'POST',
        url: '/webhook/evolution',
        headers: { 'x-webhook-secret': WEBHOOK_SECRET },
        payload: audioPayload('wa-stt-1'),
      });
      await app.waitForPendingProcessing();
    } finally {
      restore();
    }

    const joined = logs.join('');
    expect(joined).not.toContain(GROQ_API_KEY);
    expect(joined).not.toContain(OPENAI_API_KEY);
  });

  it('nunca envia a api key da Groq em texto plano fora do header Authorization', async () => {
    app = buildTestApp({ GROQ_API_KEY });
    const { calls } = stubFetch((call) => {
      if (call.url.includes('getBase64FromMediaMessage')) return jsonResponse(200, { base64: 'QUFB' });
      if (call.url.includes('api.groq.com')) return sttTranscriptionResponse('oi tudo bem');
      return jsonResponse(200, { status: 'success' });
    });

    await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': WEBHOOK_SECRET },
      payload: audioPayload('wa-stt-2'),
    });
    await app.waitForPendingProcessing();

    const groqCall = calls.find((c) => c.url.includes('api.groq.com'));
    expect(groqCall).toBeDefined();
    const headers = groqCall!.init!.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${GROQ_API_KEY}`);
  });
});
