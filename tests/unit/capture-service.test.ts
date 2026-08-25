import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/core/db/migrator.js';
import { coreMigrations } from '../../src/core/db/migrations/index.js';
import { tasksMigrations } from '../../src/modules/tasks/migrations/index.js';
import { ItemsRepository } from '../../src/modules/tasks/items-repository.js';
import { ItemService } from '../../src/modules/tasks/item-service.js';
import { JobRepository } from '../../src/core/scheduler/index.js';
import { CaptureService } from '../../src/modules/capture/capture-service.js';

function buildService(): { db: Database.Database; service: CaptureService; jobRepository: JobRepository } {
  const db = new Database(':memory:');
  runMigrations(db, [...coreMigrations, ...tasksMigrations]);
  const itemService = new ItemService(new ItemsRepository(db));
  const jobRepository = new JobRepository(db);
  return { db, service: new CaptureService(itemService, jobRepository), jobRepository };
}

describe('CaptureService (ponte captura -> task-store, RF-01/RF-03)', () => {
  it('grava item sem dueAt sem criar nenhum job', () => {
    const { service, jobRepository } = buildService();

    const [captured] = service.captureItems([{ type: 'nota', title: 'ideia solta' }], 1);

    expect(captured?.title).toBe('ideia solta');
    expect(jobRepository.findPending()).toHaveLength(0);
  });

  it('item com dueAt agenda job "reminder" avulso na tabela jobs (RF-03, sem depender de chains)', () => {
    const { service, jobRepository } = buildService();

    service.captureItems([{ type: 'compromisso', title: 'dentista', dueAt: '2026-08-28T17:00:00.000Z' }], 1);

    const pending = jobRepository.findPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ type: 'reminder', next_run_at: '2026-08-28T17:00:00.000Z' });
  });

  it('item ambíguo é gravado em inbox', () => {
    const { db, service } = buildService();

    service.captureItems([{ type: 'tarefa', title: 'algo incerto', ambiguous: true }], 1);

    const row = db.prepare('SELECT status FROM items').get() as { status: string };
    expect(row.status).toBe('inbox');
  });

  it('múltiplos itens de uma captura geram múltiplos itens gravados', () => {
    const { db, service } = buildService();

    const captured = service.captureItems(
      [
        { type: 'tarefa', title: 'a' },
        { type: 'ideia', title: 'b' },
      ],
      1,
    );

    expect(captured).toHaveLength(2);
    const count = db.prepare('SELECT COUNT(*) as c FROM items').get() as { c: number };
    expect(count.c).toBe(2);
  });

  it('grava o vínculo source_message_id em cada item capturado', () => {
    const { db, service } = buildService();

    service.captureItems([{ type: 'nota', title: 'x' }], 77);

    const row = db.prepare('SELECT source_message_id FROM items').get() as { source_message_id: number };
    expect(row.source_message_id).toBe(77);
  });

  it('reprocessar o mesmo sourceMessageId não duplica item nem cria um segundo job (idempotência, ADR-018)', () => {
    const { db, service, jobRepository } = buildService();

    service.captureItems([{ type: 'compromisso', title: 'dentista', dueAt: '2026-08-28T17:00:00.000Z' }], 5);
    const secondAttempt = service.captureItems(
      [{ type: 'compromisso', title: 'dentista', dueAt: '2026-08-28T17:00:00.000Z' }],
      5,
    );

    expect(secondAttempt).toHaveLength(0);
    const count = db.prepare('SELECT COUNT(*) as c FROM items').get() as { c: number };
    expect(count.c).toBe(1);
    expect(jobRepository.findPending()).toHaveLength(1);
  });

  it('mensagens de origem diferentes continuam gravando itens independentes', () => {
    const { db, service } = buildService();

    service.captureItems([{ type: 'nota', title: 'x' }], 1);
    service.captureItems([{ type: 'nota', title: 'y' }], 2);

    const count = db.prepare('SELECT COUNT(*) as c FROM items').get() as { c: number };
    expect(count.c).toBe(2);
  });
});
