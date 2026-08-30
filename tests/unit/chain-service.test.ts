import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/core/db/migrator.js';
import { coreMigrations } from '../../src/core/db/migrations/index.js';
import { tasksMigrations } from '../../src/modules/tasks/migrations/index.js';
import { JobRepository } from '../../src/core/scheduler/index.js';
import { EventsRepository } from '../../src/modules/tasks/events-repository.js';
import { EventService } from '../../src/modules/tasks/event-service.js';
import { ChainService } from '../../src/modules/chains/chain-service.js';
import type { ChainSettings } from '../../src/modules/chains/domain/index.js';

const SETTINGS: ChainSettings = { vesperaHour: 20, manhaHour: 8, prepMarginMin: 15 };
const FIXED_NOW = new Date('2026-08-25T13:00:00.000Z'); // terça 10h SP

function buildContext() {
  const db = new Database(':memory:');
  runMigrations(db, [...coreMigrations, ...tasksMigrations]);
  db.prepare(`INSERT INTO items (type, title, origin) VALUES ('compromisso', 'dentista', 'texto')`).run();

  const jobRepository = new JobRepository(db);
  const eventService = new EventService(new EventsRepository(db));
  const chainService = new ChainService({
    eventService,
    jobRepository,
    getSettings: () => SETTINGS,
    now: () => FIXED_NOW,
  });

  return { db, jobRepository, eventService, chainService };
}

describe('ChainService (orquestração de jobs da cadeia, FEAT-004)', () => {
  it('scheduleForEvent cria os 3 jobs reminder e marca cadeiaGerada', () => {
    const { jobRepository, eventService, chainService } = buildContext();
    const event = eventService.create({
      itemId: 1,
      title: 'dentista',
      startAt: new Date('2026-08-28T17:00:00.000Z'),
      deslocamentoMin: 30,
    });

    chainService.scheduleForEvent(event);

    const pending = jobRepository.findPending();
    expect(pending).toHaveLength(3);
    expect(pending.every((j) => j.type === 'reminder')).toBe(true);
    expect(eventService.findActiveByItemId(1)?.cadeiaGerada).toBe(true);
  });

  it('scheduleForEvent com evento cujas 3 etapas já cairiam no passado não cria job nenhum, mas ainda marca cadeiaGerada (compromisso já em cima da hora não fica sem cadeia "pendente para sempre")', () => {
    const { jobRepository, eventService, chainService } = buildContext();
    const event = eventService.create({
      itemId: 1,
      title: 'dentista',
      startAt: new Date('2026-08-25T13:30:00.000Z'), // 30 min depois de FIXED_NOW, sem margem pra nenhuma etapa
      deslocamentoMin: 30,
    });

    chainService.scheduleForEvent(event);

    expect(jobRepository.findPending()).toHaveLength(0);
    expect(eventService.findActiveByItemId(1)?.cadeiaGerada).toBe(true);
  });

  it('cada job carrega tipoCadeia e eventId no payload', () => {
    const { jobRepository, eventService, chainService } = buildContext();
    const event = eventService.create({
      itemId: 1,
      title: 'dentista',
      startAt: new Date('2026-08-28T17:00:00.000Z'),
      deslocamentoMin: 30,
    });

    chainService.scheduleForEvent(event);

    const payloads = jobRepository.findPending().map((j) => JSON.parse(j.payload) as Record<string, unknown>);
    const tipos = payloads.map((p) => p['tipoCadeia']).sort();
    expect(tipos).toEqual(['manha', 'preparo', 'vespera']);
    expect(payloads.every((p) => p['eventId'] === event.id)).toBe(true);
  });

  it('item.dropped cancela o evento ativo e todos os jobs pendentes da cadeia', async () => {
    const { db, jobRepository, eventService, chainService } = buildContext();
    const event = eventService.create({
      itemId: 1,
      title: 'dentista',
      startAt: new Date('2026-08-28T17:00:00.000Z'),
      deslocamentoMin: 30,
    });
    chainService.scheduleForEvent(event);

    await chainService.onItemDropped({ itemId: 1 });

    expect(jobRepository.findPending()).toHaveLength(0);
    const jobStatuses = db.prepare('SELECT status FROM jobs').all() as { status: string }[];
    expect(jobStatuses.every((j) => j.status === 'failed')).toBe(true);
    const eventRow = db.prepare('SELECT status FROM events WHERE id = ?').get(event.id) as { status: string };
    expect(eventRow.status).toBe('cancelado');
  });

  it('item.dropped preserva jobs já confirmed/sent da cadeia (só cancela os pending)', async () => {
    const { db, jobRepository, eventService, chainService } = buildContext();
    const event = eventService.create({
      itemId: 1,
      title: 'dentista',
      startAt: new Date('2026-08-28T17:00:00.000Z'),
      deslocamentoMin: 30,
    });
    chainService.scheduleForEvent(event);

    const [firstJob] = jobRepository.findPending();
    jobRepository.markRunning(firstJob!.id);
    jobRepository.markConfirmed(firstJob!.id, new Date());

    await chainService.onItemDropped({ itemId: 1 });

    const confirmedJob = db.prepare('SELECT status FROM jobs WHERE id = ?').get(firstJob!.id) as { status: string };
    expect(confirmedJob.status).toBe('confirmed');
    const remainingPending = jobRepository.findPending();
    expect(remainingPending).toHaveLength(0);
    const failedCount = db.prepare(`SELECT COUNT(*) as c FROM jobs WHERE status = 'failed'`).get() as { c: number };
    expect(failedCount.c).toBe(2);
  });

  it('item.dropped chamado duas vezes para o mesmo item é idempotente (entrega duplicada no bus não lança nem cancela nada duas vezes)', async () => {
    const { db, eventService, chainService } = buildContext();
    const event = eventService.create({
      itemId: 1,
      title: 'dentista',
      startAt: new Date('2026-08-28T17:00:00.000Z'),
      deslocamentoMin: 30,
    });
    chainService.scheduleForEvent(event);

    await chainService.onItemDropped({ itemId: 1 });
    await expect(chainService.onItemDropped({ itemId: 1 })).resolves.toBeUndefined();

    const eventRow = db.prepare('SELECT status FROM events WHERE id = ?').get(event.id) as { status: string };
    expect(eventRow.status).toBe('cancelado');
    const failedCount = db.prepare(`SELECT COUNT(*) as c FROM jobs WHERE status = 'failed'`).get() as { c: number };
    expect(failedCount.c).toBe(3);
  });

  it('item.dropped é no-op quando o item nunca teve evento (compromisso sem hora resolvida, ou outro tipo)', async () => {
    const { db, chainService } = buildContext();

    await expect(chainService.onItemDropped({ itemId: 999 })).resolves.toBeUndefined();
    const count = db.prepare('SELECT COUNT(*) as c FROM events').get() as { c: number };
    expect(count.c).toBe(0);
  });

  it('item.rescheduled cancela a cadeia antiga por completo e cria uma cadeia nova coerente com a nova data', async () => {
    const { db, jobRepository, eventService, chainService } = buildContext();
    const event = eventService.create({
      itemId: 1,
      title: 'dentista',
      startAt: new Date('2026-08-28T17:00:00.000Z'),
      deslocamentoMin: 30,
    });
    chainService.scheduleForEvent(event);
    const oldEventId = event.id;

    await chainService.onItemRescheduled({ itemId: 1, dueAt: '2026-09-04T17:00:00.000Z' });

    const oldEventRow = db.prepare('SELECT status FROM events WHERE id = ?').get(oldEventId) as { status: string };
    expect(oldEventRow.status).toBe('cancelado');

    const newEvent = eventService.findActiveByItemId(1);
    expect(newEvent?.startAt).toBe('2026-09-04T17:00:00.000Z');
    expect(newEvent?.cadeiaGerada).toBe(true);

    const pending = jobRepository.findPending();
    expect(pending).toHaveLength(3);
    const payloads = pending.map((j) => JSON.parse(j.payload) as Record<string, unknown>);
    expect(payloads.every((p) => p['eventId'] === newEvent!.id)).toBe(true);
  });

  it('item.rescheduled marca os jobs antigos como failed sem apagá-los nem mexer no next_run_at (rastro de auditoria, Decisões tomadas da FEAT-004)', async () => {
    const { db, jobRepository, eventService, chainService } = buildContext();
    const event = eventService.create({
      itemId: 1,
      title: 'dentista',
      startAt: new Date('2026-08-28T17:00:00.000Z'),
      deslocamentoMin: 30,
    });
    chainService.scheduleForEvent(event);
    const oldJobs = jobRepository.findPending();
    const oldFireAtById = new Map(oldJobs.map((j) => [j.id, j.next_run_at]));

    await chainService.onItemRescheduled({ itemId: 1, dueAt: '2026-09-04T17:00:00.000Z' });

    const oldJobRows = db
      .prepare(`SELECT id, status, next_run_at FROM jobs WHERE id IN (${oldJobs.map((j) => j.id).join(',')})`)
      .all() as { id: number; status: string; next_run_at: string }[];
    expect(oldJobRows).toHaveLength(3);
    expect(oldJobRows.every((j) => j.status === 'failed')).toBe(true);
    expect(oldJobRows.every((j) => j.next_run_at === oldFireAtById.get(j.id))).toBe(true);

    const totalJobCount = db.prepare('SELECT COUNT(*) as c FROM jobs').get() as { c: number };
    expect(totalJobCount.c).toBe(6); // 3 antigos (failed) + 3 novos (pending) — nunca editados in-place
  });

  it('item.rescheduled preserva o deslocamentoMin do evento anterior na cadeia nova', async () => {
    const { eventService, chainService } = buildContext();
    eventService.create({ itemId: 1, title: 'dentista', startAt: new Date('2026-08-28T17:00:00.000Z'), deslocamentoMin: 45 });
    chainService.scheduleForEvent(eventService.findActiveByItemId(1)!);

    await chainService.onItemRescheduled({ itemId: 1, dueAt: '2026-09-04T17:00:00.000Z' });

    const newEvent = eventService.findActiveByItemId(1);
    expect(newEvent?.deslocamentoMin).toBe(45);
  });

  it('item.rescheduled preserva o local do evento anterior na cadeia nova', async () => {
    const { eventService, chainService } = buildContext();
    eventService.create({
      itemId: 1,
      title: 'dentista',
      startAt: new Date('2026-08-28T17:00:00.000Z'),
      deslocamentoMin: 30,
      local: 'consultório',
    });
    chainService.scheduleForEvent(eventService.findActiveByItemId(1)!);

    await chainService.onItemRescheduled({ itemId: 1, dueAt: '2026-09-04T17:00:00.000Z' });

    const newEvent = eventService.findActiveByItemId(1);
    expect(newEvent?.local).toBe('consultório');
  });

  it('item.rescheduled não quebra quando o evento anterior nunca teve local', async () => {
    const { eventService, chainService } = buildContext();
    eventService.create({ itemId: 1, title: 'dentista', startAt: new Date('2026-08-28T17:00:00.000Z'), deslocamentoMin: 30 });
    chainService.scheduleForEvent(eventService.findActiveByItemId(1)!);

    await chainService.onItemRescheduled({ itemId: 1, dueAt: '2026-09-04T17:00:00.000Z' });

    const newEvent = eventService.findActiveByItemId(1);
    expect(newEvent?.local).toBeNull();
  });

  it('item.rescheduled é no-op quando o item nunca teve evento', async () => {
    const { db, chainService } = buildContext();

    await chainService.onItemRescheduled({ itemId: 1, dueAt: '2026-09-04T17:00:00.000Z' });

    const count = db.prepare('SELECT COUNT(*) as c FROM events').get() as { c: number };
    expect(count.c).toBe(0);
  });
});
