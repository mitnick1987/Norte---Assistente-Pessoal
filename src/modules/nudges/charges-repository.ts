import type { Database } from 'better-sqlite3';

export interface ChargeRow {
  readonly id: number;
  readonly itemId: number;
  readonly chargedOn: string;
  readonly sentAt: string;
  readonly respondedAt: string | null;
}

interface RawChargeRow {
  id: number;
  item_id: number;
  charged_on: string;
  sent_at: string;
  responded_at: string | null;
}

function toRow(row: RawChargeRow): ChargeRow {
  return {
    id: row.id,
    itemId: row.item_id,
    chargedOn: row.charged_on,
    sentAt: row.sent_at,
    respondedAt: row.responded_at,
  };
}

/** Única porta de leitura/escrita de `nudges_charges` (ARCHITECTURE.md §2) — nenhum outro módulo faz SQL direto aqui. */
export class ChargesRepository {
  constructor(private readonly db: Database) {}

  record(itemId: number, chargedOn: string): number {
    const result = this.db
      .prepare(`INSERT INTO nudges_charges (item_id, charged_on) VALUES (?, ?)`)
      .run(itemId, chargedOn);
    return Number(result.lastInsertRowid);
  }

  countChargedOn(chargedOn: string): number {
    const row = this.db
      .prepare<[string], { count: number }>(`SELECT COUNT(*) as count FROM nudges_charges WHERE charged_on = ?`)
      .get(chargedOn);
    return row?.count ?? 0;
  }

  /** Ids de itens já cobrados no dia civil informado — usado pela elegibilidade para nunca cobrar o mesmo item duas vezes no mesmo dia. */
  findItemIdsChargedOn(chargedOn: string): Set<number> {
    const rows = this.db
      .prepare<[string], { item_id: number }>(`SELECT item_id FROM nudges_charges WHERE charged_on = ?`)
      .all(chargedOn);
    return new Set(rows.map((r) => r.item_id));
  }

  /**
   * Cobrança mais recente ainda sem resposta (menu 1/2/3): é sobre este item
   * que "1"/"2"/"3" resolve — nunca o item mais recente citado na conversa em
   * geral (`tasks.findMostRecentActive`), porque algo novo pode ter sido
   * capturado depois da cobrança sair.
   */
  findMostRecentPending(): ChargeRow | undefined {
    const row = this.db
      .prepare<
        [],
        RawChargeRow
      >(`SELECT * FROM nudges_charges WHERE responded_at IS NULL ORDER BY id DESC LIMIT 1`)
      .get();
    return row ? toRow(row) : undefined;
  }

  markResponded(id: number, respondedAt: Date): void {
    this.db
      .prepare(`UPDATE nudges_charges SET responded_at = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(respondedAt.toISOString(), id);
  }
}
