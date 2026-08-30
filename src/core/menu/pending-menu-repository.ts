import type { Database } from 'better-sqlite3';

/** Quem sabe aplicar o efeito de "1"/"2"/"3" para esta origem — um por módulo que emite menu numerado. */
export type PendingMenuOrigin = 'cobranca' | 'revisao' | 'higiene';

export interface PendingMenuRow {
  readonly id: number;
  readonly origin: PendingMenuOrigin;
  readonly itemId: number;
  readonly createdAt: string;
  readonly resolvedAt: string | null;
}

interface RawPendingMenuRow {
  id: number;
  origin: PendingMenuOrigin;
  item_id: number;
  created_at: string;
  resolved_at: string | null;
}

function toRow(row: RawPendingMenuRow): PendingMenuRow {
  return { id: row.id, origin: row.origin, itemId: row.item_id, createdAt: row.created_at, resolvedAt: row.resolved_at };
}

/**
 * Registro de "qual foi a última pergunta de menu numérico feita" —
 * desambigua o executor de "1"/"2"/"3" quando mais de um módulo (cobrança,
 * revisão, higiene) pode ter emitido um menu no mesmo período (achado de
 * review pós-FEAT-007). Vive no core porque nenhum módulo é dono exclusivo:
 * `nudges` grava a origem `cobranca`, `rituals` grava `revisao`/`higiene`, e
 * o executor de comandos lê sem depender de import cruzado entre módulos.
 */
export class PendingMenuRepository {
  constructor(private readonly db: Database) {}

  record(origin: PendingMenuOrigin, itemId: number): number {
    const result = this.db
      .prepare(`INSERT INTO pending_menus (origin, item_id) VALUES (?, ?)`)
      .run(origin, itemId);
    return Number(result.lastInsertRowid);
  }

  /** Última pergunta ainda sem resposta, de qualquer origem — é sobre ELA que "1"/"2"/"3" resolve, nunca sobre "a cobrança" por padrão. */
  findMostRecentPending(): PendingMenuRow | undefined {
    const row = this.db
      .prepare<[], RawPendingMenuRow>(`SELECT * FROM pending_menus WHERE resolved_at IS NULL ORDER BY id DESC LIMIT 1`)
      .get();
    return row ? toRow(row) : undefined;
  }

  markResolved(id: number, resolvedAt: Date): void {
    this.db.prepare(`UPDATE pending_menus SET resolved_at = ? WHERE id = ?`).run(resolvedAt.toISOString(), id);
  }
}
