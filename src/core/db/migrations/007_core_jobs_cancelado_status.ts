import type { Migration } from '../../kernel/types.js';

/**
 * SQLite não suporta alterar um CHECK constraint existente — a única forma
 * de ampliar o vocabulário de `status` é recriar a tabela (padrão oficial:
 * criar nova, copiar dados, dropar a antiga, renomear). `cancelado` cobre
 * drop/reagendamento de compromisso (FEAT-004): cancelamento de rotina não
 * é falha de entrega e não pode poluir a métrica de 99,5% do PRD, que
 * ARCHITECTURE.md §6 deriva do status dos jobs — antes disso, `chains`
 * usava `failed` para isso por falta de um status próprio.
 */
export const coreJobsCanceladoStatus007: Migration = {
  id: '007_core_jobs_cancelado_status',
  up(db) {
    db.exec(`
      CREATE TABLE jobs_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        payload TEXT NOT NULL DEFAULT '{}',
        next_run_at TEXT NOT NULL,
        recurrence TEXT,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'running', 'sent', 'confirmed', 'failed', 'cancelado')),
        attempts INTEGER NOT NULL DEFAULT 0,
        delivered_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      INSERT INTO jobs_new (id, type, payload, next_run_at, recurrence, status, attempts, delivered_at, created_at, updated_at)
        SELECT id, type, payload, next_run_at, recurrence, status, attempts, delivered_at, created_at, updated_at FROM jobs;

      DROP INDEX IF EXISTS jobs_due_lookup;
      DROP TABLE jobs;
      ALTER TABLE jobs_new RENAME TO jobs;

      CREATE INDEX jobs_due_lookup ON jobs (status, next_run_at);
    `);
  },
  down(db) {
    db.exec(`
      CREATE TABLE jobs_old (
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

      -- jobs 'cancelado' viram 'failed' no downgrade — o status novo não existe no schema antigo
      -- e não há como preservar o rastro sem a coluna; é o melhor mapeamento reversível disponível.
      INSERT INTO jobs_old (id, type, payload, next_run_at, recurrence, status, attempts, delivered_at, created_at, updated_at)
        SELECT id, type, payload, next_run_at, recurrence,
          CASE WHEN status = 'cancelado' THEN 'failed' ELSE status END,
          attempts, delivered_at, created_at, updated_at FROM jobs;

      DROP INDEX IF EXISTS jobs_due_lookup;
      DROP TABLE jobs;
      ALTER TABLE jobs_old RENAME TO jobs;

      CREATE INDEX jobs_due_lookup ON jobs (status, next_run_at);
    `);
  },
};
