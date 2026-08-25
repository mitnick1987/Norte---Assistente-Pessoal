import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from '../../src/app.js';
import { buildTestApp } from '../factories/test-app.js';
import { jsonResponse, stubFetch } from '../factories/fetch-stub.js';
import { MAX_ATTEMPTS } from '../../src/core/outbox/domain/backoff.js';

const WEBHOOK_SECRET = 'a'.repeat(32);
const OWNER_JID = '5511999999999@s.whatsapp.net';

describe('falha injetada: envio sem 2xx esgota o retry exponencial (TESTING.md §4.2)', () => {
  let app: App;

  beforeEach(() => {
    app = buildTestApp();
  });

  afterEach(async () => {
    await app.fastify.close();
    app.db.close();
    vi.unstubAllGlobals();
  });

  it('marca a mensagem como failed após esgotar as tentativas, sem nunca marcar delivered_at', async () => {
    stubFetch(() => jsonResponse(500, { error: 'internal' }));

    await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': WEBHOOK_SECRET },
      payload: {
        event: 'messages.upsert',
        instance: 'norte-test',
        data: { key: { remoteJid: OWNER_JID, id: 'wa-fail-1', fromMe: false }, message: { conversation: 'ping' } },
      },
    });
    // ADR-018: o processamento (triagem->captura/comando->confirmação) roda
    // em background — o inject() só garante o ACK, não que a mensagem de
    // saída já esteja enfileirada no outbox.
    await app.waitForPendingProcessing();

    // esgota attempts manualmente até o teto, forçando o retry a ficar imediatamente elegível.
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      app.db.prepare(`UPDATE outbox_messages SET retry_after = NULL WHERE jid = ?`).run(OWNER_JID);
      await app.outboxProcessor.processPending();
    }

    const row = app.db
      .prepare('SELECT status, delivered_at, attempts FROM outbox_messages WHERE jid = ?')
      .get(OWNER_JID) as { status: string; delivered_at: string | null; attempts: number };

    expect(row.status).toBe('failed');
    expect(row.delivered_at).toBeNull();
    expect(row.attempts).toBe(MAX_ATTEMPTS);
  });
});
