import type { Migration } from '../../core/kernel/types.js';

/**
 * Anti-flood de alerta (FEAT-008, spec item 1 e Decisões tomadas): uma linha
 * por chave lógica (tipo de alerta + identificador do recurso), guardando só
 * o último disparo — é o suficiente para decidir "ainda dentro da janela"
 * sem acumular histórico. `alert_key` já embute tipo+recurso como string
 * única (ex.: "session_down", "delivery_exhausted:42") para não precisar de
 * índice composto.
 */
export const infraOpsAlertDispatches001: Migration = {
  id: '001_infra_ops_alert_dispatches',
  up(db) {
    db.exec(`
      CREATE TABLE infra_ops_alert_dispatches (
        alert_key TEXT PRIMARY KEY,
        last_sent_at TEXT NOT NULL
      );
    `);
  },
  down(db) {
    db.exec('DROP TABLE IF EXISTS infra_ops_alert_dispatches;');
  },
};
