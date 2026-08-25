import type { Database } from 'better-sqlite3';
import type { ItemOrigin, ItemPriority, ItemRecord, ItemStatus, ItemType } from './domain/index.js';

interface ItemRow {
  id: number;
  type: string;
  title: string;
  origin: string;
  status: string;
  priority: number | null;
  due_at: string | null;
  snooze_count: number;
  source_message_id: number | null;
  created_at: string;
  updated_at: string;
}

function toRecord(row: ItemRow): ItemRecord {
  return {
    id: row.id,
    type: row.type as ItemType,
    title: row.title,
    origin: row.origin as ItemOrigin,
    status: row.status as ItemStatus,
    priority: row.priority as ItemPriority | null,
    dueAt: row.due_at,
    snoozeCount: row.snooze_count,
    sourceMessageId: row.source_message_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateItemInput {
  readonly type: ItemType;
  readonly title: string;
  readonly origin: ItemOrigin;
  readonly status: ItemStatus;
  readonly priority?: ItemPriority;
  readonly dueAt?: Date;
  /** Rastreia de qual mensagem de entrada o item veio (ADR-018) — permite a varredura de recuperação detectar reprocessamento e não duplicar a gravação. */
  readonly sourceMessageId?: number;
}

export interface ListItemsFilter {
  readonly statuses?: readonly ItemStatus[];
}

/**
 * Única porta de leitura/escrita de `items` (ADR-009, ARCHITECTURE.md §2) —
 * nenhum outro módulo faz SQL direto nesta tabela; transição de status
 * sempre passa pelo serviço de domínio (item-service.ts), nunca por um
 * UPDATE solto chamado daqui de fora.
 */
export class ItemsRepository {
  constructor(private readonly db: Database) {}

  create(input: CreateItemInput): ItemRecord {
    const result = this.db
      .prepare(
        `INSERT INTO items (type, title, origin, status, priority, due_at, source_message_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.type,
        input.title,
        input.origin,
        input.status,
        input.priority ?? null,
        input.dueAt ? input.dueAt.toISOString() : null,
        input.sourceMessageId ?? null,
      );

    return this.findByIdOrThrow(Number(result.lastInsertRowid));
  }

  /** Base da idempotência do reprocessamento (ADR-018): existe item gravado por essa mensagem? */
  existsBySourceMessageId(sourceMessageId: number): boolean {
    const row = this.db
      .prepare<[number], { c: number }>('SELECT COUNT(*) as c FROM items WHERE source_message_id = ?')
      .get(sourceMessageId);
    return (row?.c ?? 0) > 0;
  }

  findById(id: number): ItemRecord | undefined {
    const row = this.db.prepare<[number], ItemRow>('SELECT * FROM items WHERE id = ?').get(id);
    return row ? toRecord(row) : undefined;
  }

  private findByIdOrThrow(id: number): ItemRecord {
    const row = this.findById(id);
    if (!row) throw new Error(`item ${id} não encontrado logo após INSERT`);
    return row;
  }

  list(filter: ListItemsFilter = {}): ItemRecord[] {
    if (!filter.statuses || filter.statuses.length === 0) {
      return this.db
        .prepare<[], ItemRow>('SELECT * FROM items ORDER BY due_at IS NULL, due_at ASC, created_at ASC')
        .all()
        .map(toRecord);
    }

    const placeholders = filter.statuses.map(() => '?').join(', ');
    return this.db
      .prepare<
        string[],
        ItemRow
      >(`SELECT * FROM items WHERE status IN (${placeholders}) ORDER BY due_at IS NULL, due_at ASC, created_at ASC`)
      .all(...filter.statuses)
      .map(toRecord);
  }

  /** Último item citado na conversa (RF-07: respostas numéricas referem-se a ele) — mais recente por criação, não por atualização. */
  findMostRecentActive(): ItemRecord | undefined {
    const row = this.db
      .prepare<
        [],
        ItemRow
      >(`SELECT * FROM items WHERE status NOT IN ('feita', 'arquivada', 'dropada') ORDER BY created_at DESC LIMIT 1`)
      .get();
    return row ? toRecord(row) : undefined;
  }

  updateStatus(id: number, status: ItemStatus): ItemRecord {
    this.db
      .prepare(`UPDATE items SET status = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(status, id);
    return this.findByIdOrThrow(id);
  }

  /** `snoozeCount` nunca é lido por fora deste módulo — incrementado só aqui, junto da transição para `adiada`. */
  snooze(id: number, newDueAt: Date): ItemRecord {
    this.db
      .prepare(
        `UPDATE items SET status = 'adiada', due_at = ?, snooze_count = snooze_count + 1, updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(newDueAt.toISOString(), id);
    return this.findByIdOrThrow(id);
  }
}
