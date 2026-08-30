import type { Database } from 'better-sqlite3';

export const RESPONSE_WINDOW_METRIC = 'janela_resposta_habitual';

interface PatternValue {
  readonly weekday: number;
  readonly hour: number;
}

/**
 * Única porta de leitura/escrita de `patterns` (ARCHITECTURE.md §2, ER) —
 * schema mínimo desta entrega (spec, Decisões tomadas): uma linha por
 * amostra de resposta, `valor` como JSON. Agregação (horário mais frequente)
 * é feita em código (`nudges/domain`), nunca em SQL.
 */
export class PatternsRepository {
  constructor(private readonly db: Database) {}

  recordResponseWindow(weekday: number, hour: number): void {
    const valor: PatternValue = { weekday, hour };
    this.db
      .prepare(`INSERT INTO patterns (metrica, valor) VALUES (?, ?)`)
      .run(RESPONSE_WINDOW_METRIC, JSON.stringify(valor));
  }

  /** Últimas `limit` amostras da métrica, mais recente primeiro na leitura crua — quem chama decide a ordem de agregação. */
  findRecentResponseWindows(limit: number): PatternValue[] {
    const rows = this.db
      .prepare<
        [string, number],
        { valor: string }
      >(`SELECT valor FROM patterns WHERE metrica = ? ORDER BY id DESC LIMIT ?`)
      .all(RESPONSE_WINDOW_METRIC, limit);

    return rows
      .map((row) => parsePatternValue(row.valor))
      .filter((value): value is PatternValue => value !== undefined);
  }
}

function parsePatternValue(json: string): PatternValue | undefined {
  try {
    const parsed = JSON.parse(json) as Partial<PatternValue>;
    if (typeof parsed.weekday !== 'number' || typeof parsed.hour !== 'number') return undefined;
    return { weekday: parsed.weekday, hour: parsed.hour };
  } catch {
    return undefined;
  }
}
