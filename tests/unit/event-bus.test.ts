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
});
