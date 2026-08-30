import type { Migration } from '../../../core/kernel/types.js';

/**
 * Rastro mínimo de cobrança enviada (RF-08): não é histórico de falhas do
 * item (nunca exposto ao usuário) — existe só para dois propósitos
 * operacionais: (1) elegibilidade "nunca cobra o mesmo item duas vezes no
 * mesmo dia" sem depender de reler o outbox inteiro; (2) resolver a qual
 * item a resposta "1"/"2"/"3" do menu se refere (mesmo papel que
 * `findMostRecentActive` cumpre para "feito"/"adia"/"dropa" em `tasks`, mas
 * aqui precisa ser específico de cobrança — o item mais recente da conversa
 * pode não ser mais o item cobrado se algo novo for capturado no meio).
 *
 * `charged_on` é o dia civil em America/Sao_Paulo (YYYY-MM-DD), calculado no
 * momento do disparo — nunca recalculado a partir de `sent_at` em SQL (mesma
 * regra de TZ explícito do resto do projeto).
 */
export const nudgesCharges002: Migration = {
  id: 'nudges_002_charges',
  up(db) {
    db.exec(`
      CREATE TABLE nudges_charges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        item_id INTEGER NOT NULL,
        charged_on TEXT NOT NULL,
        sent_at TEXT NOT NULL DEFAULT (datetime('now')),
        responded_at TEXT
      );

      -- elegibilidade filtra "já cobrei este item hoje?" por item_id + charged_on.
      CREATE INDEX nudges_charges_item_day_lookup ON nudges_charges (item_id, charged_on);
      -- resolução do menu 1/2/3 e o agregado de patterns olham sempre a cobrança mais recente ainda sem resposta.
      CREATE INDEX nudges_charges_pending_lookup ON nudges_charges (responded_at, id);
    `);
  },
  down(db) {
    db.exec('DROP TABLE IF EXISTS nudges_charges;');
  },
};
