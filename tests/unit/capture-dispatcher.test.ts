import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/core/db/migrator.js';
import { coreMigrations } from '../../src/core/db/migrations/index.js';
import { tasksMigrations } from '../../src/modules/tasks/migrations/index.js';
import { ItemsRepository } from '../../src/modules/tasks/items-repository.js';
import { ItemService } from '../../src/modules/tasks/item-service.js';
import { JobRepository } from '../../src/core/scheduler/index.js';
import { OutboxRepository } from '../../src/core/outbox/index.js';
import { CaptureService } from '../../src/modules/capture/capture-service.js';
import { buildCaptureDispatcher } from '../../src/modules/capture/capture-dispatcher.js';
import { createLogger } from '../../src/core/logger.js';
import type { TriageService, TriageResult } from '../../src/modules/capture/triage-service.js';

const JID = '5511999999999@s.whatsapp.net';
const logger = createLogger('test');

function buildContext() {
  const db = new Database(':memory:');
  runMigrations(db, [...coreMigrations, ...tasksMigrations]);
  const itemService = new ItemService(new ItemsRepository(db));
  const jobRepository = new JobRepository(db);
  const outboxRepository = new OutboxRepository(db);
  const captureService = new CaptureService(itemService, jobRepository);
  return { db, outboxRepository, captureService };
}

function stubTriageService(classify: () => Promise<TriageResult>): TriageService {
  return { classify } as unknown as TriageService;
}

function lastOutboxBody(db: Database.Database): string | undefined {
  const row = db.prepare('SELECT body FROM outbox_messages ORDER BY id DESC LIMIT 1').get() as
    | { body: string }
    | undefined;
  return row?.body;
}

describe('buildCaptureDispatcher (fluxo 5 do PRD §6)', () => {
  it('erro da triagem cai na resposta padrão de conversa, nunca em silêncio', async () => {
    const { db, outboxRepository, captureService } = buildContext();
    const triageService = stubTriageService(async () => ({ kind: 'error' }));
    const dispatch = buildCaptureDispatcher({ triageService, captureService, outboxRepository, logger });

    await dispatch('qualquer coisa', JID, 1);

    expect(lastOutboxBody(db)).toBeDefined();
    const itemCount = db.prepare('SELECT COUNT(*) as c FROM items').get() as { c: number };
    expect(itemCount.c).toBe(0);
  });

  it('classificação "conversa" enfileira resposta padrão, sem gravar item', async () => {
    const { db, outboxRepository, captureService } = buildContext();
    const triageService = stubTriageService(async () => ({
      kind: 'ok',
      output: { classification: 'conversa', items: [] },
    }));
    const dispatch = buildCaptureDispatcher({ triageService, captureService, outboxRepository, logger });

    await dispatch('que dia é hoje?', JID, 1);

    const itemCount = db.prepare('SELECT COUNT(*) as c FROM items').get() as { c: number };
    expect(itemCount.c).toBe(0);
    expect(lastOutboxBody(db)).toBeDefined();
  });

  it('classificação "captura" sem itens cai na resposta padrão (nunca captura vazia)', async () => {
    const { db, outboxRepository, captureService } = buildContext();
    const triageService = stubTriageService(async () => ({
      kind: 'ok',
      output: { classification: 'captura', items: [] },
    }));
    const dispatch = buildCaptureDispatcher({ triageService, captureService, outboxRepository, logger });

    await dispatch('hmm', JID, 1);

    const itemCount = db.prepare('SELECT COUNT(*) as c FROM items').get() as { c: number };
    expect(itemCount.c).toBe(0);
  });

  it('captura com itens grava no task-store e confirma em 1 linha', async () => {
    const { db, outboxRepository, captureService } = buildContext();
    const triageService = stubTriageService(async () => ({
      kind: 'ok',
      output: { classification: 'captura', items: [{ type: 'tarefa', title: 'pagar boleto' }] },
    }));
    const dispatch = buildCaptureDispatcher({
      triageService,
      captureService,
      outboxRepository,
      logger,
      now: () => new Date(0),
    });

    await dispatch('lembra de pagar o boleto', JID, 1);

    const item = db.prepare('SELECT title FROM items').get() as { title: string };
    expect(item.title).toBe('pagar boleto');
    const body = lastOutboxBody(db);
    expect(body).toContain('pagar boleto');
    expect(body!.split('\n')).toHaveLength(1);
  });

  it('usa Date real quando `now` não é injetado (comportamento default de produção)', async () => {
    const { outboxRepository, captureService } = buildContext();
    const triageService = stubTriageService(async () => ({ kind: 'ok', output: { classification: 'conversa', items: [] } }));
    const dispatch = buildCaptureDispatcher({ triageService, captureService, outboxRepository, logger });

    await expect(dispatch('oi', JID, 1)).resolves.toBeUndefined();
  });

  it('reprocessar o mesmo messageId não duplica item (idempotência do reprocessamento, ADR-018)', async () => {
    const { db, outboxRepository, captureService } = buildContext();
    const triageService = stubTriageService(async () => ({
      kind: 'ok',
      output: { classification: 'captura', items: [{ type: 'tarefa', title: 'pagar boleto' }] },
    }));
    const dispatch = buildCaptureDispatcher({ triageService, captureService, outboxRepository, logger });

    await dispatch('lembra de pagar o boleto', JID, 42);
    await dispatch('lembra de pagar o boleto', JID, 42);

    const itemCount = db.prepare('SELECT COUNT(*) as c FROM items').get() as { c: number };
    expect(itemCount.c).toBe(1);

    // a confirmação pode sair de novo (ADR-018: inócuo) — o que não pode é duplicar a gravação.
    const outboxCount = db.prepare('SELECT COUNT(*) as c FROM outbox_messages').get() as { c: number };
    expect(outboxCount.c).toBe(2);
  });
});
