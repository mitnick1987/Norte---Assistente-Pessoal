import type { Database } from 'better-sqlite3';
import type { z } from 'zod';
import type { EventHandler } from '../bus/event-bus.js';

/**
 * Uma migração pertence a um módulo (prefixada pelo nome dele) e roda pelo
 * runner do core em ordem estável — nunca módulo mexe em schema de outro.
 */
export interface Migration {
  /** Identificador estável e ordenável, ex.: `001_create_messages`. */
  readonly id: string;
  up: (db: Database) => void;
  down: (db: Database) => void;
}

/**
 * Contexto do turno de conversa em que a tool foi chamada — hoje só
 * `messageId` (FEAT-006 item 2), o vínculo que `create_event` grava como
 * `sourceMessageId` do item para a varredura de recuperação do boot
 * (ADR-018) não duplicar o evento remoto num reprocessamento. Handler que
 * não precisa dele simplesmente ignora o segundo parâmetro.
 */
export interface ToolCallContext {
  readonly messageId: number;
}

/**
 * Declaração de tool servida em dois transportes (tool use do brain e,
 * no M2, o servidor MCP — ADR-014): o schema zod é a única porta de
 * validação, então o mesmo objeto atende os dois sem lógica própria.
 */
export interface ToolDefinition<TInput = unknown> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodType<TInput>;
  handler: (input: TInput, ctx: ToolCallContext) => Promise<unknown>;
}

export interface CommandMatchContext {
  readonly text: string;
  readonly ownerJid: string;
}

/**
 * Executor determinístico de comandos simples (RF-07): resolve por código,
 * sem acionar o Sonnet. `match` decide se o comando se aplica; `handle`
 * produz o efeito (nunca escreve fora das tools/serviços do módulo dono).
 */
export interface CommandMatcher {
  readonly name: string;
  match: (ctx: CommandMatchContext) => boolean;
  handle: (ctx: CommandMatchContext) => Promise<CommandResult>;
}

export interface CommandResult {
  readonly replyText: string;
}

export interface JobHandlerContext {
  readonly jobId: number;
  readonly payload: unknown;
}

/** Handler de um tipo de job — sempre disparado pelo scheduler, nunca por timer em memória (ADR-004). */
export type JobHandler = (ctx: JobHandlerContext) => Promise<void>;

export type SettingsMap = Record<string, string | number | boolean>;

/**
 * Assinaturas do módulo no bus interno, por nome de evento (ex.:
 * `item.created`, `message.received`, `user.silent48h` — ARCHITECTURE.md
 * §2). O vocabulário concreto de eventos pertence aos módulos de domínio
 * (tasks, capture, chains...) que ainda não existem nesta fundação; o
 * kernel só sabe registrar handlers por nome, sem conhecer o catálogo.
 */
export type EventHandlers = Record<string, EventHandler<never>>;

/**
 * Contrato único de extensão (ADR-011). Adicionar uma funcionalidade nova é
 * criar uma pasta em src/modules/ com um manifesto — sem tocar no core nem
 * nos outros módulos.
 */
export interface ModuleManifest {
  readonly name: string;
  readonly migrations?: readonly Migration[];
  readonly tools?: readonly ToolDefinition[];
  readonly commands?: readonly CommandMatcher[];
  readonly jobs?: Readonly<Record<string, JobHandler>>;
  readonly events?: Partial<EventHandlers>;
  readonly settingsDefaults?: SettingsMap;
  /** Determinística — pré-requisito do prompt caching byte-estável (ADR-007). */
  readonly promptFragment?: () => string;
}
