import { describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/core/db/migrator.js';
import { tasksMigrations } from '../../src/modules/tasks/migrations/index.js';
import { ItemsRepository } from '../../src/modules/tasks/items-repository.js';
import { ItemService, ItemNotFoundError } from '../../src/modules/tasks/item-service.js';
import {
  InvalidStatusTransitionError,
  ITEM_DROPPED_EVENT,
  ITEM_RESCHEDULED_EVENT,
  type TasksEventEmitter,
} from '../../src/modules/tasks/domain/index.js';

const FIXED_NOW = new Date('2026-08-25T13:00:00.000Z'); // terça 10h em America/Sao_Paulo

function buildService(emit?: TasksEventEmitter): ItemService {
  const db = new Database(':memory:');
  runMigrations(db, tasksMigrations);
  return new ItemService(new ItemsRepository(db), () => FIXED_NOW, emit);
}

describe('ItemService', () => {
  it('create com status default "ativa" quando não ambíguo', () => {
    const service = buildService();

    const item = service.create({ type: 'nota', title: 'ideia solta', origin: 'texto' });

    expect(item.status).toBe('ativa');
  });

  it('create respeita status "inbox" explícito (classificação ambígua, RF-01)', () => {
    const service = buildService();

    const item = service.create({ type: 'tarefa', title: 'algo incerto', origin: 'texto', status: 'inbox' });

    expect(item.status).toBe('inbox');
  });

  it('complete transiciona para feita', () => {
    const service = buildService();
    const item = service.create({ type: 'tarefa', title: 'x', origin: 'texto' });

    const result = service.complete(item.id);

    expect(result.status).toBe('feita');
  });

  it('complete de item já feito lança InvalidStatusTransitionError', () => {
    const service = buildService();
    const item = service.create({ type: 'tarefa', title: 'x', origin: 'texto' });
    service.complete(item.id);

    expect(() => service.complete(item.id)).toThrow(InvalidStatusTransitionError);
  });

  it('complete de item inexistente lança ItemNotFoundError', () => {
    const service = buildService();

    expect(() => service.complete(999)).toThrow(ItemNotFoundError);
  });

  it('drop sempre lógico — nunca remove a linha (ADR-009)', async () => {
    const service = buildService();
    const item = service.create({ type: 'tarefa', title: 'x', origin: 'texto' });

    const result = await service.drop(item.id);

    expect(result.status).toBe('dropada');
  });

  it('archive transiciona para arquivada (usado futuramente por hygiene, RF-11)', () => {
    const service = buildService();
    const item = service.create({ type: 'tarefa', title: 'x', origin: 'texto' });

    const result = service.archive(item.id);

    expect(result.status).toBe('arquivada');
  });

  it('snoozeByText resolve data relativa e transiciona para adiada', async () => {
    const service = buildService();
    const item = service.create({ type: 'tarefa', title: 'x', origin: 'texto' });

    const result = await service.snoozeByText(item.id, 'sexta');

    expect(result?.status).toBe('adiada');
    expect(result?.dueAt).toBe('2026-08-28T12:00:00.000Z');
  });

  it('snoozeByText retorna undefined quando o texto não tem data reconhecível', async () => {
    const service = buildService();
    const item = service.create({ type: 'tarefa', title: 'x', origin: 'texto' });

    const result = await service.snoozeByText(item.id, 'não sei quando');

    expect(result).toBeUndefined();
  });

  it('snoozeByText sobre item já adiado re-adia (adiada -> adiada é transição válida)', async () => {
    const service = buildService();
    const item = service.create({ type: 'tarefa', title: 'x', origin: 'texto' });
    await service.snoozeByText(item.id, 'sexta');

    const result = await service.snoozeByText(item.id, 'segunda que vem');

    expect(result?.status).toBe('adiada');
    expect(result?.dueAt).toBe('2026-08-31T12:00:00.000Z');
  });

  it('list nunca inclui itens em inbox por padrão', () => {
    const service = buildService();
    service.create({ type: 'tarefa', title: 'ambígua', origin: 'texto', status: 'inbox' });
    service.create({ type: 'tarefa', title: 'clara', origin: 'texto' });

    const items = service.list();

    expect(items.map((i) => i.title)).toEqual(['clara']);
  });

  it('list inclui inbox quando includeInbox é true', () => {
    const service = buildService();
    service.create({ type: 'tarefa', title: 'ambígua', origin: 'texto', status: 'inbox' });

    const items = service.list({ includeInbox: true });

    expect(items.map((i) => i.title)).toContain('ambígua');
  });

  describe('publicação de eventos no bus (FEAT-004: chains reage sem tasks conhecer chains)', () => {
    it('drop publica ITEM_DROPPED_EVENT com o itemId, depois de confirmada a transição', async () => {
      const emit = vi.fn();
      const service = buildService(emit);
      const item = service.create({ type: 'compromisso', title: 'dentista', origin: 'texto' });

      await service.drop(item.id);

      expect(emit).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledWith(ITEM_DROPPED_EVENT, { itemId: item.id });
    });

    it('drop propaga a exceção e não publica evento quando a transição é inválida', async () => {
      const emit = vi.fn();
      const service = buildService(emit);
      const item = service.create({ type: 'tarefa', title: 'x', origin: 'texto' });
      await service.drop(item.id);
      emit.mockClear();

      await expect(service.drop(item.id)).rejects.toThrow(InvalidStatusTransitionError);
      expect(emit).not.toHaveBeenCalled();
    });

    it('snoozeByText publica ITEM_RESCHEDULED_EVENT com itemId e dueAt resolvido (ISO) quando a data é reconhecida', async () => {
      const emit = vi.fn();
      const service = buildService(emit);
      const item = service.create({ type: 'compromisso', title: 'dentista', origin: 'texto' });

      const result = await service.snoozeByText(item.id, 'sexta');

      expect(emit).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledWith(ITEM_RESCHEDULED_EVENT, { itemId: item.id, dueAt: result!.dueAt });
    });

    it('snoozeByText não publica nenhum evento quando o texto não tem data reconhecível', async () => {
      const emit = vi.fn();
      const service = buildService(emit);
      const item = service.create({ type: 'tarefa', title: 'x', origin: 'texto' });

      await service.snoozeByText(item.id, 'não sei quando');

      expect(emit).not.toHaveBeenCalled();
    });

    it('complete e archive nunca publicam evento (só drop/reschedule afetam a cadeia, FEAT-004)', () => {
      const emit = vi.fn();
      const service = buildService(emit);
      const item1 = service.create({ type: 'tarefa', title: 'a', origin: 'texto' });
      const item2 = service.create({ type: 'tarefa', title: 'b', origin: 'texto' });

      service.complete(item1.id);
      service.archive(item2.id);

      expect(emit).not.toHaveBeenCalled();
    });

    it('sem emit injetado (default no-op), drop e snoozeByText não lançam (compatibilidade com todo teste/uso que não assina nada)', async () => {
      const service = buildService();
      const item = service.create({ type: 'tarefa', title: 'x', origin: 'texto' });

      await expect(service.drop(item.id)).resolves.toMatchObject({ status: 'dropada' });
    });
  });
});
