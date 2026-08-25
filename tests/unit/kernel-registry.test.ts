import { describe, expect, it, vi } from 'vitest';
import { KernelRegistry, DuplicateModuleError, DuplicateJobTypeError } from '../../src/core/kernel/registry.js';
import { EventBus } from '../../src/core/bus/event-bus.js';
import type { ModuleManifest } from '../../src/core/kernel/types.js';

function buildManifest(overrides: Partial<ModuleManifest> & { name: string }): ModuleManifest {
  return { ...overrides };
}

describe('KernelRegistry', () => {
  it('rejeita registrar dois módulos com o mesmo nome', () => {
    const registry = new KernelRegistry();
    registry.register(buildManifest({ name: 'chains' }));

    expect(() => registry.register(buildManifest({ name: 'chains' }))).toThrow(DuplicateModuleError);
  });

  it('compõe tools de múltiplos módulos em ordem determinística por nome de módulo', () => {
    const registry = new KernelRegistry();
    registry.register(
      buildManifest({
        name: 'zzz-module',
        tools: [{ name: 'zzz.tool', description: '', inputSchema: { parse: () => undefined } as never, handler: async () => undefined }],
      }),
    );
    registry.register(
      buildManifest({
        name: 'aaa-module',
        tools: [{ name: 'aaa.tool', description: '', inputSchema: { parse: () => undefined } as never, handler: async () => undefined }],
      }),
    );

    const tools = registry.getTools();

    expect(tools.map((t) => t.name)).toEqual(['aaa.tool', 'zzz.tool']);
  });

  it('compõe o prompt final em ordem alfabética de nome de módulo, independente da ordem de registro', () => {
    const registry = new KernelRegistry();
    registry.register(buildManifest({ name: 'zzz-module', promptFragment: () => 'fragmento-zzz' }));
    registry.register(buildManifest({ name: 'aaa-module', promptFragment: () => 'fragmento-aaa' }));

    const prompt = registry.buildPrompt();

    expect(prompt.indexOf('fragmento-aaa')).toBeLessThan(prompt.indexOf('fragmento-zzz'));
  });

  it('ignora módulos sem promptFragment na composição do prompt', () => {
    const registry = new KernelRegistry();
    registry.register(buildManifest({ name: 'sem-prompt' }));
    registry.register(buildManifest({ name: 'com-prompt', promptFragment: () => 'texto' }));

    expect(registry.buildPrompt()).toBe('texto');
  });

  it('rejeita dois módulos declarando handler para o mesmo tipo de job', () => {
    const registry = new KernelRegistry();
    registry.register(buildManifest({ name: 'mod-a', jobs: { reminder: async () => undefined } }));
    registry.register(buildManifest({ name: 'mod-b', jobs: { reminder: async () => undefined } }));

    expect(() => registry.getJobHandlers()).toThrow(DuplicateJobTypeError);
  });

  it('funde settingsDefaults de todos os módulos', () => {
    const registry = new KernelRegistry();
    registry.register(buildManifest({ name: 'mod-a', settingsDefaults: { a: 1 } }));
    registry.register(buildManifest({ name: 'mod-b', settingsDefaults: { b: 2 } }));

    expect(registry.getSettingsDefaults()).toEqual({ a: 1, b: 2 });
  });

  it('lista nomes de módulos registrados em ordem determinística', () => {
    const registry = new KernelRegistry();
    registry.register(buildManifest({ name: 'b' }));
    registry.register(buildManifest({ name: 'a' }));

    expect(registry.listModuleNames()).toEqual(['a', 'b']);
  });

  it('wireEvents inscreve no bus os handlers declarados por múltiplos módulos para o mesmo evento', async () => {
    const registry = new KernelRegistry();
    const handlerA = vi.fn();
    const handlerB = vi.fn();
    registry.register(buildManifest({ name: 'mod-a', events: { 'item.created': handlerA } }));
    registry.register(buildManifest({ name: 'mod-b', events: { 'item.created': handlerB } }));

    const bus = new EventBus<Record<string, unknown>>();
    registry.wireEvents(bus);
    await bus.emit('item.created', { id: 1 });

    expect(handlerA).toHaveBeenCalledWith({ id: 1 });
    expect(handlerB).toHaveBeenCalledWith({ id: 1 });
  });

  it('wireEvents não falha quando nenhum módulo declara events', () => {
    const registry = new KernelRegistry();
    registry.register(buildManifest({ name: 'sem-eventos' }));

    const bus = new EventBus<Record<string, unknown>>();
    expect(() => registry.wireEvents(bus)).not.toThrow();
  });
});
