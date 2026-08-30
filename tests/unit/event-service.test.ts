import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/core/db/migrator.js';
import { tasksMigrations } from '../../src/modules/tasks/migrations/index.js';
import { EventsRepository } from '../../src/modules/tasks/events-repository.js';
import { EventService } from '../../src/modules/tasks/event-service.js';
import { EventNotFoundError } from '../../src/modules/tasks/domain/index.js';

function buildService(): { db: Database.Database; service: EventService } {
  const db = new Database(':memory:');
  runMigrations(db, tasksMigrations);
  db.prepare(`INSERT INTO items (type, title, origin) VALUES ('compromisso', 'dentista', 'texto')`).run();
  return { db, service: new EventService(new EventsRepository(db)) };
}

describe('EventService (CRUD de domínio de events, FEAT-004)', () => {
  it('create grava evento ativo, cadeiaGerada false', () => {
    const { service } = buildService();

    const event = service.create({
      itemId: 1,
      title: 'dentista',
      startAt: new Date('2026-08-28T17:00:00.000Z'),
      deslocamentoMin: 30,
    });

    expect(event).toMatchObject({ itemId: 1, title: 'dentista', status: 'ativo', cadeiaGerada: false, gcalId: null });
  });

  it('markCadeiaGerada marca a flag sem alterar o status', () => {
    const { service } = buildService();
    const event = service.create({ itemId: 1, title: 'dentista', startAt: new Date(), deslocamentoMin: 0 });

    service.markCadeiaGerada(event.id);

    const reloaded = service.findActiveByItemId(1);
    expect(reloaded?.cadeiaGerada).toBe(true);
  });

  it('cancel transiciona para cancelado (deleção lógica, ADR-009) — nunca remove a linha', () => {
    const { db, service } = buildService();
    const event = service.create({ itemId: 1, title: 'dentista', startAt: new Date(), deslocamentoMin: 0 });

    const cancelled = service.cancel(event.id);

    expect(cancelled.status).toBe('cancelado');
    const count = db.prepare('SELECT COUNT(*) as c FROM events').get() as { c: number };
    expect(count.c).toBe(1);
  });

  it('cancel de evento inexistente lança EventNotFoundError', () => {
    const { service } = buildService();

    expect(() => service.cancel(999)).toThrow(EventNotFoundError);
  });

  it('findActiveByItemId retorna undefined quando o item nunca teve evento', () => {
    const { service } = buildService();

    expect(service.findActiveByItemId(1)).toBeUndefined();
  });

  it('cancelActiveForItem cancela o evento ativo do item e devolve o registro cancelado', () => {
    const { service } = buildService();
    const event = service.create({ itemId: 1, title: 'dentista', startAt: new Date(), deslocamentoMin: 0 });

    const cancelled = service.cancelActiveForItem(1);

    expect(cancelled?.id).toBe(event.id);
    expect(cancelled?.status).toBe('cancelado');
    expect(service.findActiveByItemId(1)).toBeUndefined();
  });

  it('cancelActiveForItem é no-op quando o item nunca teve evento (compromisso sem hora resolvida, ou outro tipo)', () => {
    const { service } = buildService();

    expect(service.cancelActiveForItem(1)).toBeUndefined();
  });

  it('cancelActiveForItem chamado duas vezes é idempotente (segunda chamada não encontra evento ativo)', () => {
    const { service } = buildService();
    service.create({ itemId: 1, title: 'dentista', startAt: new Date(), deslocamentoMin: 0 });

    service.cancelActiveForItem(1);
    const second = service.cancelActiveForItem(1);

    expect(second).toBeUndefined();
  });
});
