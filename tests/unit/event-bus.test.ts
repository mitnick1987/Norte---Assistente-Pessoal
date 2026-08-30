import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../../src/core/bus/event-bus.js';

interface Events {
  'item.created': { id: number };
}

describe('EventBus', () => {
  it('entrega o payload a todos os handlers inscritos no evento', async () => {
    const bus = new EventBus<Events>();
    const handlerA = vi.fn();
    const handlerB = vi.fn();

    bus.on('item.created', handlerA);
    bus.on('item.created', handlerB);

    await bus.emit('item.created', { id: 1 });

    expect(handlerA).toHaveBeenCalledWith({ id: 1 });
    expect(handlerB).toHaveBeenCalledWith({ id: 1 });
  });

  it('não falha ao emitir evento sem nenhum handler inscrito', async () => {
    const bus = new EventBus<Events>();
    await expect(bus.emit('item.created', { id: 1 })).resolves.toBeUndefined();
  });

  it('aguarda handlers assíncronos antes de resolver o emit', async () => {
    const bus = new EventBus<Events>();
    const order: string[] = [];

    bus.on('item.created', async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push('handler');
    });

    await bus.emit('item.created', { id: 1 });
    order.push('depois-do-emit');

    expect(order).toEqual(['handler', 'depois-do-emit']);
  });

  it('isola falha por assinante: handler que lança não impede os demais de rodar', async () => {
    const bus = new EventBus<Events>();
    const handlerOk = vi.fn();

    bus.on('item.created', () => {
      throw new Error('boom');
    });
    bus.on('item.created', handlerOk);

    await expect(bus.emit('item.created', { id: 1 })).resolves.toBeUndefined();
    expect(handlerOk).toHaveBeenCalledWith({ id: 1 });
  });

  it('isola falha de handler assíncrono (promise rejeitada) sem impedir os demais', async () => {
    const bus = new EventBus<Events>();
    const handlerOk = vi.fn();

    bus.on('item.created', async () => {
      throw new Error('boom assíncrono');
    });
    bus.on('item.created', handlerOk);

    await expect(bus.emit('item.created', { id: 1 })).resolves.toBeUndefined();
    expect(handlerOk).toHaveBeenCalledWith({ id: 1 });
  });

  it('loga o erro do handler que falhou, sem propagar para quem chamou emit', async () => {
    const logger = { error: vi.fn() };
    const bus = new EventBus<Events>({ logger });
    const error = new Error('boom');

    bus.on('item.created', () => {
      throw error;
    });

    await bus.emit('item.created', { id: 1 });

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'item.created', err: error }),
      expect.any(String),
    );
  });
});
