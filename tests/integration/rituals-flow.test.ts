import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp, type App } from '../../src/app.js';
import { buildTestEnv } from '../factories/test-app.js';
import type { Env } from '../../src/core/env.js';
import { jsonResponse, stubFetch, type FetchCall } from '../factories/fetch-stub.js';
import { anthropicErrorResponse, anthropicTextResponse } from '../factories/anthropic-stub.js';

const OWNER_JID = '5511999999999@s.whatsapp.net';
// terça-feira 2026-08-25, 07:30 America/Sao_Paulo (10:30 UTC) — antes do
// horário default do briefing (7h40) e bem antes da revisão (21h30), então
// o seed do boot agenda os dois jobs ainda para hoje.
const FIXED_NOW = new Date('2026-08-25T10:30:00.000Z');

/** Sobe o app de verdade (`app.start()`) — é o que dispara `seedRitualJobs` no boot. */
function startApp(env: Env = buildTestEnv({ PORT: 0 })): App {
  return buildApp(env, { outboxSleep: async () => undefined, provisionWebhook: false, now: () => FIXED_NOW });
}

function textWebhookPayload(waMessageId: string, text: string) {
  return {
    event: 'messages.upsert',
    instance: 'norte-test',
    data: { key: { remoteJid: OWNER_JID, id: waMessageId, fromMe: false }, message: { conversation: text } },
  };
}

function routedStub(anthropicHandler: (call: FetchCall) => Response) {
  return stubFetch((call: FetchCall) => {
    if (call.url.includes('api.anthropic.com')) return anthropicHandler(call);
    return jsonResponse(200, { status: 'success' });
  });
}

async function captureItem(app: App, waId: string, title: string): Promise<void> {
  routedStub(() =>
    jsonResponse(200, {
      content: [
        { type: 'tool_use', id: 'tc_1', name: 'submit_triage', input: { classification: 'captura', items: [{ type: 'tarefa', title }] } },
      ],
      usage: {},
    }),
  );
  await app.fastify.inject({
    method: 'POST',
    url: '/webhook/evolution',
    headers: { 'x-webhook-secret': 'a'.repeat(32) },
    payload: textWebhookPayload(waId, `lembrar de ${title}`),
  });
  await app.waitForPendingProcessing();
}

describe('briefing matinal (RF-05, FEAT-006)', () => {
  let app: App | undefined;

  afterEach(async () => {
    if (app) await app.stop();
    vi.unstubAllGlobals();
  });

  it('job briefing vence e o Sonnet redige a partir da agenda stub e das prioridades reais do task-store', async () => {
    app = startApp();
    routedStub(() => jsonResponse(200, { status: 'success' }));
    await app.start();
    await captureItem(app, 'wa-1', 'revisar contrato');

    routedStub(() => anthropicTextResponse('Bom dia! Hoje sem compromisso marcado. Encara revisar contrato primeiro?'));

    app.db.prepare(`UPDATE jobs SET next_run_at = ? WHERE type = 'briefing'`).run(new Date(FIXED_NOW.getTime() - 1000).toISOString());
    await app.scheduler.tick();

    const outboxRow = app.db.prepare(`SELECT body FROM outbox_messages WHERE is_proactive = 1 ORDER BY id DESC LIMIT 1`).get() as
      | { body: string }
      | undefined;
    expect(outboxRow?.body).toBe('Bom dia! Hoje sem compromisso marcado. Encara revisar contrato primeiro?');
  });

  it('falha injetada: Sonnet indisponível cai no template de fallback com os mesmos dados — o briefing chega de um jeito ou de outro', async () => {
    app = startApp();
    routedStub(() => jsonResponse(200, { status: 'success' }));
    await app.start();
    await captureItem(app, 'wa-1', 'revisar contrato');

    routedStub(() => anthropicErrorResponse(503));

    app.db.prepare(`UPDATE jobs SET next_run_at = ? WHERE type = 'briefing'`).run(new Date(FIXED_NOW.getTime() - 1000).toISOString());
    await app.scheduler.tick();

    const outboxRow = app.db.prepare(`SELECT body FROM outbox_messages WHERE is_proactive = 1 ORDER BY id DESC LIMIT 1`).get() as
      | { body: string }
      | undefined;
    expect(outboxRow?.body).toBeDefined();
    expect(outboxRow!.body).toContain('revisar contrato');
    expect(outboxRow!.body).toContain('Qual você encara primeiro?');
  });

  it('job briefing tem recorrência diária — dispara de novo sem precisar de novo seed manual', async () => {
    app = startApp();
    routedStub(() => jsonResponse(200, { status: 'success' }));
    await app.start();
    routedStub(() => anthropicTextResponse('bom dia'));

    const seeded = app.db.prepare(`SELECT recurrence FROM jobs WHERE type = 'briefing'`).get() as { recurrence: string };
    expect(seeded.recurrence).toBe('daily');

    const overdueAt = new Date(FIXED_NOW.getTime() - 1000).toISOString();
    app.db.prepare(`UPDATE jobs SET next_run_at = ? WHERE type = 'briefing'`).run(overdueAt);
    await app.scheduler.tick();

    const after = app.db.prepare(`SELECT next_run_at, status FROM jobs WHERE type = 'briefing'`).get() as {
      next_run_at: string;
      status: string;
    };
    // recorrência diária (ADR-004): job volta a `pending` com uma nova
    // ocorrência, nunca fica `confirmed`/parado depois de disparar — é
    // exatamente esse recálculo que garante o briefing de amanhã sem
    // precisar de um novo seed manual.
    expect(after.status).toBe('pending');
    expect(after.next_run_at).not.toBe(overdueAt);
  });
});

describe('revisão noturna (RF-06, FEAT-006)', () => {
  let app: App | undefined;

  afterEach(async () => {
    if (app) await app.stop();
    vi.unstubAllGlobals();
  });

  it('job revisao vence e o Sonnet redige em no máximo 3 mensagens', async () => {
    app = startApp();
    routedStub(() => jsonResponse(200, { status: 'success' }));
    await app.start();

    routedStub(() => anthropicTextResponse('Fechou bem hoje.\n\nAmanhã segue tranquilo.'));

    app.db.prepare(`UPDATE jobs SET next_run_at = ? WHERE type = 'revisao'`).run(new Date(FIXED_NOW.getTime() - 1000).toISOString());
    await app.scheduler.tick();

    const rows = app.db.prepare(`SELECT body FROM outbox_messages WHERE is_proactive = 1 ORDER BY id`).all() as { body: string }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(3);
  });

  it('falha injetada: Sonnet indisponível cai no template de fallback da revisão, com os mesmos dados', async () => {
    app = startApp();
    routedStub(() => jsonResponse(200, { status: 'success' }));
    await app.start();

    routedStub(() => anthropicErrorResponse(500));

    app.db.prepare(`UPDATE jobs SET next_run_at = ? WHERE type = 'revisao'`).run(new Date(FIXED_NOW.getTime() - 1000).toISOString());
    await app.scheduler.tick();

    const rows = app.db.prepare(`SELECT body FROM outbox_messages WHERE is_proactive = 1 ORDER BY id`).all() as { body: string }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(3);
  });
});

describe('catch-up de briefing/revisão no boot (ADR-004, mesmo padrão de reminder)', () => {
  let app: App | undefined;

  afterEach(async () => {
    if (app) await app.stop();
    vi.unstubAllGlobals();
  });

  it('jobs briefing/revisao com next_run_at vencido antes da subida disparam no catch-up do boot', async () => {
    const env = buildTestEnv({ PORT: 0 });

    // Primeira "vida" do processo: só semeia os jobs, não deixa disparar ainda.
    routedStub(() => jsonResponse(200, { status: 'success' }));
    const seedingApp = startApp(env);
    await seedingApp.start();
    const overdue = new Date(FIXED_NOW.getTime() - 60_000).toISOString();
    seedingApp.db.prepare(`UPDATE jobs SET next_run_at = ? WHERE type IN ('briefing', 'revisao')`).run(overdue);
    await seedingApp.stop();

    // "processo reinicia" — nova instância sobre o mesmo arquivo de banco
    // (mesmo `DB_PATH` do env), mesmo padrão de catch-up-restart.test.ts.
    routedStub(() => anthropicTextResponse('mensagem de catch-up'));
    app = startApp(env);
    await app.scheduler.runCatchUp();

    const proactiveCount = app.db.prepare(`SELECT COUNT(*) as c FROM outbox_messages WHERE is_proactive = 1`).get() as {
      c: number;
    };
    expect(proactiveCount.c).toBeGreaterThan(0);
  });
});

describe('custo — chamadas do brain e dos rituais registram usage em messages (RF-15)', () => {
  let app: App | undefined;

  afterEach(async () => {
    if (app) await app.stop();
    vi.unstubAllGlobals();
  });

  it('loop de tool-use da conversa livre grava tokens_in/tokens_out/cache_read_tokens em messages com intent="conversa"', async () => {
    app = startApp();
    routedStub(() => jsonResponse(200, { status: 'success' }));
    await app.start();

    let call = 0;
    routedStub((c: FetchCall) => {
      if (!c.url.includes('api.anthropic.com')) return jsonResponse(200, { status: 'success' });
      call++;
      if (call === 1) {
        return jsonResponse(200, {
          content: [
            { type: 'tool_use', id: 'tc_1', name: 'submit_triage', input: { classification: 'conversa', items: [] } },
          ],
          usage: { input_tokens: 300, output_tokens: 80, cache_read_input_tokens: 0 },
        });
      }
      return anthropicTextResponse('resposta do brain', {
        input_tokens: 900,
        output_tokens: 40,
        cache_read_input_tokens: 700,
      });
    });

    await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': 'a'.repeat(32) },
      payload: textWebhookPayload('wa-conversa-1', 'oi, tudo bem?'),
    });
    await app.waitForPendingProcessing();

    const row = app.db
      .prepare(`SELECT tokens_in, tokens_out, cache_read_tokens FROM messages WHERE intent = 'conversa'`)
      .get() as { tokens_in: number; tokens_out: number; cache_read_tokens: number } | undefined;
    expect(row).toEqual({ tokens_in: 900, tokens_out: 40, cache_read_tokens: 700 });
  });

  it('duas chamadas sucessivas do briefing no mesmo "dia" simulado resultam em cache_read_input_tokens > 0 na segunda', async () => {
    app = startApp();
    routedStub(() => jsonResponse(200, { status: 'success' }));
    await app.start();

    let call = 0;
    routedStub(() => {
      call++;
      return anthropicTextResponse('briefing', { cache_read_input_tokens: call === 1 ? 0 : 500 });
    });

    app.db.prepare(`UPDATE jobs SET next_run_at = ?, recurrence = NULL WHERE type = 'briefing'`).run(
      new Date(FIXED_NOW.getTime() - 1000).toISOString(),
    );
    await app.scheduler.tick();
    app.db.prepare(`INSERT INTO jobs (type, next_run_at, status, attempts) VALUES ('briefing', ?, 'pending', 0)`).run(
      new Date(FIXED_NOW.getTime() - 1000).toISOString(),
    );
    await app.scheduler.tick();

    const rows = app.db
      .prepare(`SELECT cache_read_tokens FROM messages WHERE intent = 'briefing' ORDER BY id`)
      .all() as { cache_read_tokens: number }[];
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows[0]!.cache_read_tokens).toBe(0);
    expect(rows[rows.length - 1]!.cache_read_tokens).toBeGreaterThan(0);
  });
});
