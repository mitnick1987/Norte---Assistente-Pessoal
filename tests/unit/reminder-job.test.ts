import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/core/db/migrator.js';
import { coreMigrations } from '../../src/core/db/migrations/index.js';
import { OutboxRepository } from '../../src/core/outbox/index.js';
import { JobRepository } from '../../src/core/scheduler/index.js';
import { buildReminderJobHandler } from '../../src/modules/capture/reminder-job.js';

const OWNER_JID = '5511999999999@s.whatsapp.net';

function buildHandler() {
  const db = new Database(':memory:');
  runMigrations(db, coreMigrations);
  const outboxRepository = new OutboxRepository(db);
  const jobRepository = new JobRepository(db);
  const handler = buildReminderJobHandler({ outboxRepository, ownerJid: OWNER_JID });
  return { outboxRepository, jobRepository, handler };
}

describe('handler do job reminder (RF-03, caminho sem LLM)', () => {
  it('enfileira mensagem de template no outbox, sem nenhuma chamada externa', async () => {
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
});
