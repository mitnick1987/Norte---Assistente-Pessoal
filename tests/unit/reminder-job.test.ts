import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/core/db/migrator.js';
import { coreMigrations } from '../../src/core/db/migrations/index.js';
import { OutboxRepository } from '../../src/core/outbox/index.js';
import { JobRepository } from '../../src/core/scheduler/index.js';
import { buildReminderJobHandler } from '../../src/modules/capture/reminder-job.js';
import { assertToneIsSafe } from '../tone/forbidden-patterns.js';

const OWNER_JID = '5511999999999@s.whatsapp.net';
const FIXED_NOW = new Date('2026-08-28T16:00:00.000Z'); // 1h antes do compromisso de exemplo

function buildHandler(now: () => Date = () => FIXED_NOW) {
  const db = new Database(':memory:');
  runMigrations(db, coreMigrations);
  const outboxRepository = new OutboxRepository(db);
  const jobRepository = new JobRepository(db);
  const handler = buildReminderJobHandler({ outboxRepository, ownerJid: OWNER_JID, now });
  return { outboxRepository, jobRepository, handler };
}

describe('handler do job reminder (RF-03, caminho sem LLM)', () => {
  it('enfileira mensagem de template pontual no outbox quando o payload não tem tipoCadeia (inalterado desde a FEAT-002)', async () => {
    const { outboxRepository, jobRepository, handler } = buildHandler();
    const jobId = jobRepository.create({ type: 'reminder', nextRunAt: new Date() });

    await handler({ jobId, payload: { itemId: 42, title: 'pagar boleto' } });

    const pending = outboxRepository.findPending(new Date().toISOString());
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ jid: OWNER_JID, body: 'Lembrete: pagar boleto', is_proactive: 1 });
  });

  it('payload malformado (sem itemId) lança erro em vez de enfileirar mensagem incorreta', async () => {
    const { jobRepository, handler } = buildHandler();
    const jobId = jobRepository.create({ type: 'reminder', nextRunAt: new Date() });

    await expect(handler({ jobId, payload: { title: 'sem id' } })).rejects.toThrow();
  });

  const chainPayloadBase = {
    itemId: 1,
    eventId: 1,
    title: 'dentista',
    startAt: '2026-08-28T17:00:00.000Z',
    deslocamentoMin: 30,
  };

  it('payload com tipoCadeia "vespera" menciona o compromisso, sem tempo restante', async () => {
    const { outboxRepository, jobRepository, handler } = buildHandler();
    const jobId = jobRepository.create({ type: 'reminder', nextRunAt: new Date() });

    await handler({ jobId, payload: { ...chainPayloadBase, tipoCadeia: 'vespera' } });

    const [message] = outboxRepository.findPending(new Date().toISOString());
    expect(message?.body).toContain('dentista');
    assertToneIsSafe(message!.body);
  });

  it('payload com tipoCadeia "manha" menciona o compromisso', async () => {
    const { outboxRepository, jobRepository, handler } = buildHandler();
    const jobId = jobRepository.create({ type: 'reminder', nextRunAt: new Date() });

    await handler({ jobId, payload: { ...chainPayloadBase, tipoCadeia: 'manha' } });

    const [message] = outboxRepository.findPending(new Date().toISOString());
    expect(message?.body).toContain('dentista');
    assertToneIsSafe(message!.body);
  });

  it('payload com tipoCadeia "preparo" formula o alerta como tempo restante calculado no momento do disparo', async () => {
    const { outboxRepository, jobRepository, handler } = buildHandler(() => FIXED_NOW);
    const jobId = jobRepository.create({ type: 'reminder', nextRunAt: new Date() });

    await handler({ jobId, payload: { ...chainPayloadBase, tipoCadeia: 'preparo' } });

    const [message] = outboxRepository.findPending(new Date().toISOString());
    // FIXED_NOW é 1h antes do startAt (17:00 UTC) — 60 min restantes.
    expect(message?.body).toMatch(/\b60\b/);
    expect(message?.body).toMatch(/min/);
    assertToneIsSafe(message!.body);
  });

  it('alerta de preparo recalcula o tempo restante a partir de `now` no disparo, não de um valor congelado na criação do job', async () => {
    const laterNow = new Date('2026-08-28T16:45:00.000Z'); // 15 min antes do compromisso
    const { outboxRepository, jobRepository, handler } = buildHandler(() => laterNow);
    const jobId = jobRepository.create({ type: 'reminder', nextRunAt: new Date() });

    await handler({ jobId, payload: { ...chainPayloadBase, tipoCadeia: 'preparo' } });

    const [message] = outboxRepository.findPending(new Date().toISOString());
    expect(message?.body).toMatch(/\b15\b/);
  });
});
