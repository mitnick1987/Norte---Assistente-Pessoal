import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from '../../src/app.js';
import { buildTestApp } from '../factories/test-app.js';
import { stubFetch, jsonResponse } from '../factories/fetch-stub.js';

const OWNER_JID = '5511999999999@s.whatsapp.net';

function textWebhookPayload(waMessageId: string, text: string) {
  return {
    event: 'messages.upsert',
    instance: 'norte-test',
    data: { key: { remoteJid: OWNER_JID, id: waMessageId, fromMe: false }, message: { conversation: text } },
  };
}

/**
 * Insere a mensagem de entrada anterior direto no DB com `created_at` no
 * passado — mesmo padrão de `pending-recovery-boot.test.ts`: `created_at` é
 * sempre `datetime('now')` da própria coluna (SQLite), nunca o `now()`
 * injetado pelo teste, então simular "essa mensagem chegou há 4 dias" só é
 * possível escrevendo a coluna diretamente.
 */
function insertOldInboundMessage(app: App, waMessageId: string, createdAt: string): void {
  app.db
    .prepare(`INSERT INTO messages (direction, wa_message_id, jid, body, created_at) VALUES ('in', ?, ?, 'oi', ?)`)
    .run(waMessageId, OWNER_JID, createdAt);
}

describe('modo retorno sem culpa (RF-10, FEAT-007, PRD §6 fluxo 6)', () => {
  let app: App | undefined;

  afterEach(async () => {
    if (app) await app.stop();
    vi.unstubAllGlobals();
  });

  it('48h de silêncio com item vencido pendente de cobrança: mensagem do usuário reaparece e gera exatamente 1 resumo, nenhuma cobrança despejada junto', async () => {
    stubFetch(() => jsonResponse(200, { status: 'success' }));
    const reactivationAt = new Date('2026-08-29T13:00:00.000Z');
    app = buildTestApp({}, { now: () => reactivationAt });
    await app.start();

    // desativa os jobs-âncora (briefing/revisão/cobrança) recém-semeados no
    // boot — isolar só o efeito do modo retorno; o catch-up deles já tem
    // suite própria (rituals-flow.test.ts, nudges-flow.test.ts).
    app.db.prepare(`UPDATE jobs SET status = 'cancelado' WHERE type IN ('briefing', 'revisao', 'cobranca')`).run();

    // última mensagem de entrada há 4 dias (>= 48h de silêncio).
    insertOldInboundMessage(app, 'wa-1', '2026-08-25 15:00:00');

    // item vencido, criado durante o silêncio simulado.
    app.db
      .prepare(`INSERT INTO items (type, title, origin, status, due_at) VALUES ('tarefa', 'pagar boleto', 'texto', 'ativa', ?)`)
      .run('2026-08-26T10:00:00.000Z');

    // mensagem de entrada nova chega agora — reativação.
    await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': 'a'.repeat(32) },
      payload: textWebhookPayload('wa-2', 'voltei'),
    });
    await app.waitForPendingProcessing();

    const proactiveMessages = app.db
      .prepare(`SELECT body FROM outbox_messages WHERE is_proactive = 1`)
      .all() as { body: string }[];
    expect(proactiveMessages).toHaveLength(1);
    expect(proactiveMessages[0]!.body).not.toContain('pagar boleto');
  });

  it('modo retorno ativo nunca suprime reminder de compromisso com hora — só cobrança é suprimida (spec: "áreas sensíveis")', async () => {
    stubFetch(() => jsonResponse(200, { status: 'success' }));
    const now = new Date('2026-08-29T13:00:00.000Z');
    app = buildTestApp({}, { now: () => now });
    await app.start();
    app.db.prepare(`UPDATE jobs SET status = 'cancelado' WHERE type IN ('briefing', 'revisao', 'cobranca')`).run();

    // silêncio de 4 dias — modo retorno ativo no instante do tick abaixo.
    insertOldInboundMessage(app, 'wa-1', '2026-08-25 15:00:00');

    const itemId = app.db
      .prepare(`INSERT INTO items (type, title, origin, status, due_at) VALUES ('compromisso', 'dentista', 'texto', 'ativa', ?) RETURNING id`)
      .get('2026-08-29T19:00:00.000Z') as unknown as { id: number };
    const eventId = app.db
      .prepare(
        `INSERT INTO events (item_id, title, start_at, deslocamento_min, cadeia_gerada, status) VALUES (?, 'dentista', ?, 30, 1, 'ativo') RETURNING id`,
      )
      .get(itemId.id, '2026-08-29T19:00:00.000Z') as unknown as { id: number };
    app.db
      .prepare(
        `INSERT INTO jobs (type, payload, status, next_run_at) VALUES ('reminder', ?, 'pending', '2020-01-01T00:00:00.000Z')`,
      )
      .run(JSON.stringify({ tipoCadeia: 'manha', eventId: eventId.id, itemId: itemId.id, title: 'dentista', startAt: '2026-08-29T19:00:00.000Z', deslocamentoMin: 30 }));

    await app.scheduler.tick();
    await app.outboxProcessor.processPending();

    const reminderMessages = app.db
      .prepare(`SELECT body FROM outbox_messages WHERE body LIKE '%dentista%'`)
      .all() as { body: string }[];
    expect(reminderMessages).toHaveLength(1);
  });

  it('silêncio < 48h não gera resumo de reentrada nem suprime nada', async () => {
    stubFetch(() => jsonResponse(200, { status: 'success' }));
    const now = new Date('2026-08-30T13:00:00.000Z');
    app = buildTestApp({}, { now: () => now });
    await app.start();
    app.db.prepare(`UPDATE jobs SET status = 'cancelado' WHERE type IN ('briefing', 'revisao', 'cobranca')`).run();

    // última mensagem há 2h — bem abaixo do limiar de 48h.
    insertOldInboundMessage(app, 'wa-1', '2026-08-30 11:00:00');

    await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': 'a'.repeat(32) },
      payload: textWebhookPayload('wa-2', 'oi de novo'),
    });
    await app.waitForPendingProcessing();

    const proactiveMessages = app.db.prepare(`SELECT body FROM outbox_messages WHERE is_proactive = 1`).all();
    expect(proactiveMessages).toHaveLength(0);
  });
});
