import { describe, expect, it } from 'vitest';
import { canTransition, assertTransition, InvalidStatusTransitionError } from '../../src/modules/tasks/domain/item.js';
import type { ItemStatus } from '../../src/modules/tasks/domain/item.js';

describe('transições de estado de item (ADR-009)', () => {
  it('permite inbox -> ativa', () => {
    expect(canTransition('inbox', 'ativa')).toBe(true);
  });

  it('permite ativa -> feita', () => {
    expect(canTransition('ativa', 'feita')).toBe(true);
  });

  it('permite ativa -> dropada (deleção lógica, nunca DELETE)', () => {
    expect(canTransition('ativa', 'dropada')).toBe(true);
  });

  it('permite adiada -> ativa (reativação após adiar)', () => {
    expect(canTransition('adiada', 'ativa')).toBe(true);
  });

  const terminalStatuses: ItemStatus[] = ['feita', 'arquivada', 'dropada'];
  it.each(terminalStatuses)('estado terminal "%s" não permite nenhuma transição', (status) => {
    expect(canTransition(status, 'ativa')).toBe(false);
    expect(canTransition(status, 'feita')).toBe(false);
  });

  it('rejeita feita -> dropada', () => {
    expect(canTransition('feita', 'dropada')).toBe(false);
  });

  it('assertTransition lança InvalidStatusTransitionError em transição inválida', () => {
    expect(() => assertTransition('feita', 'ativa')).toThrow(InvalidStatusTransitionError);
  });

  it('assertTransition não lança em transição válida', () => {
    expect(() => assertTransition('inbox', 'dropada')).not.toThrow();
  });
});
