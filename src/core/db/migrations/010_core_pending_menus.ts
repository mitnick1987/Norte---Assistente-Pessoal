import type { Migration } from '../../kernel/types.js';

/**
 * Achado de review pós-FEAT-007: o executor de "1"/"2"/"3" tinha um único
 * dono (nudges/cobrança) — qualquer menu numerado emitido por outro módulo
 * (revisão, higiene) não tinha resolver próprio, e o dígito solto do usuário
 * era sempre capturado pela cobrança pendente, mesmo quando a pergunta mais
 * recente era de outro módulo. Esta tabela é o registro de "qual foi a
 * última pergunta de menu numérico feita" — vive no core (não em `nudges`)
 * porque mais de um módulo escreve nela (cobrança, revisão, higiene) e o
 * executor de comandos que lê é agnóstico de módulo dono.
 *
 * Só a pergunta mais recente sem resposta importa: "1"/"2"/"3" resolve
 * contra ela, nunca contra "a cobrança" por padrão. `item_id` é o item ao
 * qual a pergunta se refere; `origin` decide qual serviço aplica o efeito.
 */
export const corePendingMenus010: Migration = {
  id: '010_core_pending_menus',
  up(db) {
    db.exec(`
      CREATE TABLE pending_menus (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        origin TEXT NOT NULL CHECK (origin IN ('cobranca', 'revisao', 'higiene')),
        item_id INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        resolved_at TEXT
      );

      -- resolução do "1/2/3" olha sempre a pergunta mais recente ainda sem resposta.
      CREATE INDEX pending_menus_pending_lookup ON pending_menus (resolved_at, id);
    `);
  },
  down(db) {
    db.exec('DROP TABLE IF EXISTS pending_menus;');
  },
};
