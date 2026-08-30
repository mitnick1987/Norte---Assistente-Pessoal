import type { Database } from 'better-sqlite3';
import type { EventRecord, EventStatus } from './domain/index.js';

interface EventRow {
  id: number;
  item_id: number;
  gcal_id: string | null;
  title: string;
  start_at: string;
  end_at: string | null;
  local: string | null;
  deslocamento_min: number;
  cadeia_gerada: number;
  status: string;
  created_at: string;
  updated_at: string;
}

function toRecord(row: EventRow): EventRecord {
  return {
    id: row.id,
    itemId: row.item_id,
    gcalId: row.gcal_id,
    title: row.title,
    startAt: row.start_at,
    endAt: row.end_at,
    local: row.local,
    deslocamentoMin: row.deslocamento_min,
    cadeiaGerada: row.cadeia_gerada === 1,
    status: row.status as EventStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateEventInput {
  readonly itemId: number;
  readonly title: string;
  readonly startAt: Date;
  readonly endAt?: Date;
  readonly local?: string;
  readonly deslocamentoMin: number;
  /** Já conhecido no momento da criação (sincronização de leitura, FEAT-005) — evento nascido no Google, não por captura própria. */
  readonly gcalId?: string;
}

/**
 * Única porta de leitura/escrita de `events` (ADR-009, ARCHITECTURE.md §2) —
 * mesmo padrão de `ItemsRepository`: nenhum outro módulo faz SQL direto
 * nesta tabela, transição de status sempre passa pelo serviço de domínio
 * (event-service.ts).
 */
export class EventsRepository {
  constructor(private readonly db: Database) {}

  create(input: CreateEventInput): EventRecord {
    const result = this.db
      .prepare(
        `INSERT INTO events (item_id, gcal_id, title, start_at, end_at, local, deslocamento_min, cadeia_gerada)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
      )
      .run(
        input.itemId,
        input.gcalId ?? null,
        input.title,
        input.startAt.toISOString(),
        input.endAt ? input.endAt.toISOString() : null,
        input.local ?? null,
        input.deslocamentoMin,
      );

    return this.findByIdOrThrow(Number(result.lastInsertRowid));
  }

  findById(id: number): EventRecord | undefined {
    const row = this.db.prepare<[number], EventRow>('SELECT * FROM events WHERE id = ?').get(id);
    return row ? toRecord(row) : undefined;
  }

  private findByIdOrThrow(id: number): EventRecord {
    const row = this.findById(id);
    if (!row) throw new Error(`evento ${id} não encontrado logo após INSERT`);
    return row;
  }

  /** Deduplicação da sincronização de leitura (FEAT-005, spec item 3): evento do Google já visto não gera `event` interno nem cadeia de novo. */
  findByGcalId(gcalId: string): EventRecord | undefined {
    const row = this.db.prepare<[string], EventRow>('SELECT * FROM events WHERE gcal_id = ?').get(gcalId);
    return row ? toRecord(row) : undefined;
  }

  /** Grava o `gcal_id` retornado pela API do Google após criar o evento remoto (FEAT-005, spec item 4) — chave de idempotência de `create_event`. */
  setGcalId(id: number, gcalId: string): EventRecord {
    this.db
      .prepare(`UPDATE events SET gcal_id = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(gcalId, id);
    return this.findByIdOrThrow(id);
  }

  /** Evento ativo mais recente de um item — um compromisso tem no máximo um evento vivo por vez (reagendamento cancela o anterior antes de criar o novo). */
  findActiveByItemId(itemId: number): EventRecord | undefined {
    const row = this.db
      .prepare<
        [number],
        EventRow
      >(`SELECT * FROM events WHERE item_id = ? AND status = 'ativo' ORDER BY created_at DESC LIMIT 1`)
      .get(itemId);
    return row ? toRecord(row) : undefined;
  }

  markCadeiaGerada(id: number): void {
    this.db
      .prepare(`UPDATE events SET cadeia_gerada = 1, updated_at = datetime('now') WHERE id = ?`)
      .run(id);
  }

  cancel(id: number): EventRecord {
    this.db
      .prepare(`UPDATE events SET status = 'cancelado', updated_at = datetime('now') WHERE id = ?`)
      .run(id);
    return this.findByIdOrThrow(id);
  }
}
