import type { Migration } from '../../../core/kernel/types.js';

/**
 * Índice único parcial em `gcal_id` (FEAT-005, achado de review pós-merge):
 * a sincronização de leitura do Google Calendar decide se cria `event`
 * fazendo `findByGcalId` antes de escrever, mas sem unicidade no schema essa
 * checagem é só convenção de aplicação — re-sync concorrente ou um retry
 * após crash no meio da escrita pode duplicar o `event` do mesmo compromisso
 * do Google (lembretes em dobro). `WHERE gcal_id IS NOT NULL` porque a
 * imensa maioria dos eventos nasce de captura própria, sem `gcal_id` — não
 * dá pra exigir unicidade sobre NULL (SQLite trata cada NULL como distinto
 * em índice único, então isso já seria inofensivo, mas o parcial deixa a
 * intenção explícita e mais barato de manter).
 */
export const tasksEventsGcalIdUnique006: Migration = {
  id: 'tasks_006_events_gcal_id_unique',
  up(db) {
    db.exec(`
      CREATE UNIQUE INDEX events_gcal_id_unique ON events (gcal_id)
        WHERE gcal_id IS NOT NULL;
    `);
  },
  down(db) {
    db.exec('DROP INDEX IF EXISTS events_gcal_id_unique;');
  },
};
