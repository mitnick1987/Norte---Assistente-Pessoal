import type { Migration } from '../../../core/kernel/types.js';

/**
 * Fonte única da verdade do task-store (ADR-009): nenhuma escrita fora do
 * serviço de domínio deste módulo. `adiamentos_count` existe para a higiene
 * automática (RF-11, feature futura) e nunca sai da camada de domínio — a
 * garantia é testada, não só uma convenção de código.
 *
 * Datas em UTC (ISO 8601), TZ America/Sao_Paulo aplicado na borda de
 * cálculo/exibição (CODE_STYLE §2), nunca no armazenamento.
 */
export const tasksItems001: Migration = {
  id: 'tasks_001_items',
  up(db) {
    db.exec(`
      CREATE TABLE items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL CHECK (type IN ('tarefa', 'ideia', 'compromisso', 'lembrete', 'nota')),
        title TEXT NOT NULL,
        origin TEXT NOT NULL CHECK (origin IN ('texto', 'audio', 'foto', 'encaminhada', 'email', 'trabalho')),
        status TEXT NOT NULL DEFAULT 'inbox'
          CHECK (status IN ('inbox', 'ativa', 'em_andamento', 'feita', 'adiada', 'arquivada', 'dropada')),
        priority INTEGER CHECK (priority IN (1, 2, 3)),
        due_at TEXT,
        snooze_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      -- listagens e o executor ("lista", "qual a próxima") filtram por status
      -- o tempo todo; sem índice, toda query varre a tabela inteira à medida
      -- que ela só cresce (deleção lógica, ADR-009, nunca encolhe).
      CREATE INDEX items_status_lookup ON items (status);
      CREATE INDEX items_due_at_lookup ON items (due_at);
    `);
  },
  down(db) {
    db.exec('DROP TABLE IF EXISTS items;');
  },
};
