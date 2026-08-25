import type { Migration } from '../../kernel/types.js';

/**
 * Coração da proatividade (ADR-004): nenhum comportamento proativo nasce
 * fora desta tabela. next_run_at em UTC (ISO 8601) — o cálculo de
 * recorrência aplica America/Sao_Paulo explicitamente antes de gravar aqui,
 * nunca depende do fuso do processo.
 */
export const coreJobs003: Migration = {
  id: '003_core_jobs',
  up(db) {
    db.exec(`
      CREATE TABLE jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        payload TEXT NOT NULL DEFAULT '{}',
        next_run_at TEXT NOT NULL,
        recurrence TEXT,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'running', 'sent', 'confirmed', 'failed')),
        attempts INTEGER NOT NULL DEFAULT 0,
        delivered_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- poll do scheduler filtra por status + next_run_at a cada 30s.
      CREATE INDEX jobs_due_lookup ON jobs (status, next_run_at);
    `);
  },
  down(db) {
    db.exec('DROP TABLE IF EXISTS jobs;');
  },
};
