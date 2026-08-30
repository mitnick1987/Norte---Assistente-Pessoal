import type { EventBus, EventHandler } from '../bus/event-bus.js';
import type {
  CommandMatcher,
  JobHandler,
  Migration,
  ModuleManifest,
  SettingsMap,
  ToolDefinition,
} from './types.js';

export class DuplicateModuleError extends Error {
  constructor(name: string) {
    super(`módulo "${name}" já registrado`);
    this.name = 'DuplicateModuleError';
  }
}

export class DuplicateJobTypeError extends Error {
  constructor(jobType: string, moduleName: string) {
    super(`tipo de job "${jobType}" já registrado (colisão em "${moduleName}")`);
    this.name = 'DuplicateJobTypeError';
  }
}

/**
 * Registro e composição dos módulos ativos. Fragmentos de prompt, tools,
 * commands e migrações são sempre concatenados em ordem alfabética de
 * `module.name` — nunca ordem de registro — para que o prompt final seja
 * byte-estável independente da ordem em que app.ts lista os módulos
 * (pré-requisito do cache do ADR-007, ainda não exercitado nesta feature).
 */
export class KernelRegistry {
  private readonly modules = new Map<string, ModuleManifest>();

  register(manifest: ModuleManifest): void {
    if (this.modules.has(manifest.name)) {
      throw new DuplicateModuleError(manifest.name);
    }
    this.modules.set(manifest.name, manifest);
  }

  private sortedModules(): ModuleManifest[] {
    return [...this.modules.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  getMigrations(): readonly Migration[] {
    return this.sortedModules().flatMap((m) => m.migrations ?? []);
  }

  getTools(): readonly ToolDefinition[] {
    return this.sortedModules().flatMap((m) => m.tools ?? []);
  }

  getCommands(): readonly CommandMatcher[] {
    return this.sortedModules().flatMap((m) => m.commands ?? []);
  }

  getJobHandlers(): ReadonlyMap<string, JobHandler> {
    const handlers = new Map<string, JobHandler>();
    for (const module of this.sortedModules()) {
      for (const [jobType, handler] of Object.entries(module.jobs ?? {})) {
        if (handlers.has(jobType)) {
          throw new DuplicateJobTypeError(jobType, module.name);
        }
        handlers.set(jobType, handler);
      }
    }
    return handlers;
  }

  getSettingsDefaults(): SettingsMap {
    return this.sortedModules().reduce<SettingsMap>(
      (acc, m) => ({ ...acc, ...(m.settingsDefaults ?? {}) }),
      {},
    );
  }

  /** Concatenação determinística — a ordem é o nome do módulo, nunca a ordem de registro. */
  buildPrompt(): string {
    return this.sortedModules()
      .map((m) => m.promptFragment?.())
      .filter((fragment): fragment is string => Boolean(fragment))
      .join('\n\n');
  }

  /**
   * Módulos ativos ordenados por nome, na forma mínima que `core/llm`
   * precisa para montar o system prompt do brain (`buildBrainSystemPrompt`,
   * ADR-007/FEAT-006) — usado quando o bloco de tom RSD-safe (fixo no core,
   * não um `promptFragment` de módulo) precisa entrar depois dos fragmentos,
   * fora deste método. `buildPrompt()` acima continua servindo quem só
   * precisa da concatenação crua, sem o bloco de tom.
   */
  getModules(): readonly { readonly name: string; readonly promptFragment?: () => string }[] {
    return this.sortedModules();
  }

  /**
   * Inscreve no bus todo handler de evento declarado pelos módulos — é
   * assim que "capture emite item.created, chains reage" (ARCHITECTURE.md
   * §2) vira código sem um módulo importar o outro diretamente. O kernel
   * não conhece o payload de cada evento (isso é contrato entre módulos de
   * domínio, que ainda não existem nesta fundação) — daí o cast controlado.
   */
  wireEvents(bus: EventBus<Record<string, unknown>>): void {
    for (const module of this.sortedModules()) {
      for (const [eventName, handler] of Object.entries(module.events ?? {})) {
        if (handler) bus.on(eventName, handler as EventHandler<unknown>);
      }
    }
  }

  listModuleNames(): readonly string[] {
    return this.sortedModules().map((m) => m.name);
  }
}
