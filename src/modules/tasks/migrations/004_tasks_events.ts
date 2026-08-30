import type { Migration } from '../../../core/kernel/types.js';

/**
 * `events` é dado de domínio do task-store (FEAT-004, Decisões tomadas):
 * compromisso com horário, sujeito às mesmas regras de deleção lógica e à
 * mesma FK lógica de `item_id` que `items`/`jobs` já seguem. `gcal_id` fica
 * nulo nesta feature (Google Calendar é FEAT-005) — a coluna já nasce no
 * schema para não exigir outra migração quando essa sincronização chegar.
 *
 * `item_id` sem FK física pelo mesmo motivo de `source_message_id`
 * (migração 002): módulo não força FK cross-schema fora do próprio domínio
 * quando o vínculo já é validado em código (aqui o vínculo é dentro do
 * próprio módulo `tasks`, mas mantemos o padrão de índice em vez de FK
 * declarada, coerente com o resto do schema).
 *
 * Datas em UTC (ISO 8601) — TZ America/Sao_Paulo é aplicado na borda de
 * cálculo (expandChain), nunca no armazenamento (CODE_STYLE §2).
 */
export const tasksEvents004: Migration = {
  id: 'tasks_004_events',
  up(db) {
    db.exec(`
      CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id INTEGER NOT NULL,
        gcal_id TEXT,
        title TEXT NOT NULL,
        start_at TEXT NOT NULL,
        end_at TEXT,
        local TEXT,
        deslocamento_min INTEGER NOT NULL DEFAULT 0,
        cadeia_gerada INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'cancelado')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- regeneração busca o evento ativo de um item (no máximo um por vez);
      -- disparo da cadeia e cancelamento por drop buscam por item_id o tempo
      -- todo, sem índice a query varreria a tabela inteira à medida que ela
      -- só cresce (deleção lógica, nunca encolhe).
      CREATE INDEX events_item_id_lookup ON events (item_id);
      CREATE INDEX events_status_lookup ON events (status);
    `);
  },
  down(db) {
    db.exec('DROP TABLE IF EXISTS events;');
  },
};
