import type { Migration } from '../../../core/kernel/types.js';

/**
 * `patterns` (ARCHITECTURE.md §3, ER): schema mínimo — só `janela_resposta_habitual`
 * nesta entrega (spec FEAT-007, Decisões tomadas). Nasce dentro de `nudges`
 * porque é o único consumidor até o RF-24 (M3) justificar a extração para um
 * módulo `patterns` próprio — mesma regra de "nasce onde é usado" já aplicada
 * a outras decisões do projeto.
 *
 * `metrica` não é chave primária: o ER prevê mais de uma métrica no futuro
 * (RF-24), mas cada uma pode ter mais de uma linha ao longo do tempo (ex.:
 * uma amostra por resposta) — quem lê agrega em código, não em SQL.
 */
export const nudgesPatterns001: Migration = {
  id: 'nudges_001_patterns',
  up(db) {
    db.exec(`
      CREATE TABLE patterns (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        metrica TEXT NOT NULL,
        valor TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX patterns_metrica_lookup ON patterns (metrica);
    `);
  },
  down(db) {
    db.exec('DROP TABLE IF EXISTS patterns;');
  },
};
