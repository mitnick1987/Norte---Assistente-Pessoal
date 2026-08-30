import type { Migration } from '../../kernel/types.js';

/**
 * FEAT-006 (achado de review): o teto diário de proativas continua limite
 * duro para todo mundo (RF-24: "teto diário permanece como limite duro em
 * settings") — esta coluna NÃO isenta nada da checagem. Ela só marca
 * briefing/revisão (RF-05/RF-06) para irem primeiro na fila do outbox
 * (`findPending`, ORDER BY is_anchor_ritual DESC): se o teto for atingido
 * durante o processamento de um tick, é sempre uma proativa comum
 * (lembrete/cobrança) que fica represada, nunca o ritual-âncora — coerente
 * com "briefing e revisão nunca deixam de chegar" (PRD §7), que hoje só
 * cobre falha do Sonnet (fallback de template), não concorrência pelo teto.
 */
export const coreOutboxAnchorRitual009: Migration = {
  id: '009_core_outbox_anchor_ritual',
  up(db) {
    db.exec(`
      ALTER TABLE outbox_messages ADD COLUMN is_anchor_ritual INTEGER NOT NULL DEFAULT 0 CHECK (is_anchor_ritual IN (0, 1));
    `);
  },
  down(db) {
    db.exec(`
      ALTER TABLE outbox_messages DROP COLUMN is_anchor_ritual;
    `);
  },
};
