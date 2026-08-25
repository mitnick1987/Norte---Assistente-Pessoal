import Database from 'better-sqlite3';

/**
 * WAL é obrigatório (ADR-003): permite leitura concorrente com o scheduler
 * escrevendo, sem lock de arquivo inteiro a cada tick de poll.
 */
export function openDatabase(path: string): Database.Database {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}
