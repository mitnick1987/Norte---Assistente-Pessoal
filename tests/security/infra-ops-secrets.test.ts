import { Writable } from 'node:stream';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from '../../src/app.js';
import { buildTestApp } from '../factories/test-app.js';
import { jsonResponse, stubFetch } from '../factories/fetch-stub.js';
import { createLogger } from '../../src/core/logger.js';
import { runMigrations } from '../../src/core/db/migrator.js';
import { infraOpsMigrations } from '../../src/infra-ops/migrations/index.js';
import { EmailAlerter } from '../../src/infra-ops/email-alerter.js';
import { AlertDispatchRepository } from '../../src/infra-ops/alert-dispatch-repository.js';
import { ResendMailer, type Mailer } from '../../src/infra-ops/mailer.js';

// hoisted pelo vitest: precisa ficar no nível do módulo, não dentro do `it`
// (mesmo padrão de tests/unit/mailer.test.ts) — o `sendMail` real do
// nodemailer nunca roda em teste, só o transporte fica real o bastante para
// provar que é o caminho de fato do SmtpMailer.send que propaga o erro.
const sendMailMock = vi.fn();
vi.mock('nodemailer', () => ({
  default: { createTransport: () => ({ sendMail: sendMailMock }) },
}));

const WEBHOOK_SECRET = 'a'.repeat(32);
const RESEND_API_KEY = 'chave-resend-nao-pode-vazar';
const ALERT_EMAIL = 'dono-nao-pode-vazar@example.com';

/**
 * Sobrescrever `process.stdout.write` não captura nada em produção: o
 * destino padrão do pino escreve no fd 1 via sonic-boom, por baixo do
 * override JS (o fdget dele é o fd real, não o stream do Node) — e em teste
 * (`NODE_ENV=test`) o logger nasce em nível `silent`, então a linha que loga
 * nunca roda e a asserção fica vazia por construção (achado de review
 * FEAT-008). `createLogger` aceita um `Writable` injetável — é a única forma
 * de capturar a saída real do serializer/redact de produção neste teste.
 */
function captureLoggerOutput(): { chunks: string[]; destination: Writable } {
  const chunks: string[] = [];
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  return { chunks, destination };
}

function buildRealAlerter(mailer: Mailer | undefined, destination: Writable) {
  const db = new Database(':memory:');
  runMigrations(db, infraOpsMigrations);
  const logger = createLogger('production', destination);
  const alerter = new EmailAlerter(
    { alertEmail: ALERT_EMAIL, getAntiFloodWindowMs: () => 30 * 60_000 },
    mailer,
    new AlertDispatchRepository(db),
    logger,
  );
  return { alerter, db };
}

/**
 * S9 (extensão FEAT-008): RESEND_API_KEY nunca aparece em log, mesmo em
 * debug ou em falha de envio — e nunca viaja fora do header Authorization
 * esperado pela API do Resend (SECURITY.md §4).
 */
describe('S9 (extensão FEAT-008): RESEND_API_KEY nunca viaja fora do header Authorization', () => {
  let app: App;

  afterEach(async () => {
    await app.fastify.close();
    app.db.close();
    vi.unstubAllGlobals();
  });

  it('nunca envia a RESEND_API_KEY em texto plano fora do header Authorization', async () => {
    const { calls } = stubFetch((call) => {
      if (call.url.includes('api.resend.com')) return jsonResponse(200, { id: 'stub' });
      return jsonResponse(200, { status: 'success' });
    });
    app = buildTestApp({ RESEND_API_KEY, ALERT_EMAIL });

    await app.fastify.inject({
      method: 'POST',
      url: '/webhook/evolution',
      headers: { 'x-webhook-secret': WEBHOOK_SECRET },
      payload: { event: 'connection.update', instance: 'norte-test', data: { state: 'close' } },
    });

    const resendCall = calls.find((c) => c.url.includes('api.resend.com'));
    expect(resendCall).toBeDefined();
    const headers = resendCall!.init!.headers as Record<string, string>;
    expect(headers['Authorization']).toBe(`Bearer ${RESEND_API_KEY}`);
    expect(resendCall!.init!.body as string).not.toContain(RESEND_API_KEY);
  });
});

/**
 * S9 (extensão FEAT-008): segredo/PII do dono nunca aparece em log real —
 * exige logger de produção de verdade (createLogger com destination
 * injetado), não o `buildTestApp` (NODE_ENV=test roda em nível `silent`,
 * então a linha `logger.error` nunca executa e a asserção fica vazia por
 * construção — achado de review FEAT-008, ver captureLoggerOutput acima).
 */
describe('S9 (extensão FEAT-008): segredos e PII do dono nunca aparecem em log real', () => {
  it('não expõe RESEND_API_KEY no log quando o envio via ResendMailer falha', async () => {
    stubFetch((call) => {
      if (call.url.includes('api.resend.com')) return jsonResponse(401, { message: `invalid key ${RESEND_API_KEY}` });
      return jsonResponse(500, { error: 'internal' });
    });

    const { chunks, destination } = captureLoggerOutput();
    const { alerter, db } = buildRealAlerter(new ResendMailer(RESEND_API_KEY), destination);
    try {
      await alerter.alertSessionDown({ state: 'close' });
    } finally {
      db.close();
      vi.unstubAllGlobals();
    }

    const output = chunks.join('');
    expect(output).toContain('falha ao enviar e-mail de alerta');
    expect(output).not.toContain(RESEND_API_KEY);
  });

  it('não expõe SMTP_URL/credencial no log quando o envio via SmtpMailer falha (simetria com o Resend)', async () => {
    const SMTP_URL = 'smtps://dono:senha-nao-pode-vazar@smtp.test:465';
    // shape real de erro de conexão SMTP: bibliotecas como nodemailer podem
    // ecoar a URL de conexão completa (com credencial embutida) na mensagem
    // de erro de transporte, não só o código ECONNREFUSED.
    sendMailMock.mockRejectedValueOnce(new Error(`ECONNREFUSED ao conectar em ${SMTP_URL}`));
    const { SmtpMailer } = await import('../../src/infra-ops/mailer.js');
    const smtpMailer = new SmtpMailer(SMTP_URL, 'alertas@dono-provider.com');

    const { chunks, destination } = captureLoggerOutput();
    const { alerter, db } = buildRealAlerter(smtpMailer, destination);

    try {
      await alerter.alertSessionDown({ state: 'close' });
    } finally {
      db.close();
    }

    const output = chunks.join('');
    expect(output).toContain('falha ao enviar e-mail de alerta');
    expect(output).not.toContain('senha-nao-pode-vazar');
    expect(output).not.toContain(SMTP_URL);
  });

  it('não expõe ALERT_EMAIL (PII do dono) no log de erro quando não há transporte configurado', async () => {
    const { chunks, destination } = captureLoggerOutput();
    const { alerter, db } = buildRealAlerter(undefined, destination);

    try {
      await alerter.alertSessionDown({ state: 'close' });
    } finally {
      db.close();
    }

    const output = chunks.join('');
    expect(output).toContain('alerta sem transporte de e-mail configurado');
    expect(output).not.toContain(ALERT_EMAIL);
  });
});
