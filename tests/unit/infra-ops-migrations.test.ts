import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations, rollbackMigration } from '../../src/core/db/migrator.js';
import { infraOpsMigrations } from '../../src/infra-ops/migrations/index.js';
import { AlertDispatchRepository } from '../../src/infra-ops/alert-dispatch-repository.js';

describe('migração infra_ops_001_alert_dispatches', () => {
  it('cria a tabela e permite gravar/ler o último disparo por chave lógica', () => {
    const db = new Database(':memory:');
    runMigrations(db, infraOpsMigrations);
    const repository = new AlertDispatchRepository(db);
    const sentAt = new Date('2026-08-30T12:00:00.000Z');

    repository.recordSent('session_down', sentAt);

    expect(repository.findLastSentAt('session_down')?.toISOString()).toBe(sentAt.toISOString());
    expect(repository.findLastSentAt('outra_chave')).toBeUndefined();
  });

  it('upsert: gravar de novo na mesma chave atualiza o timestamp em vez de duplicar linha', () => {
    const db = new Database(':memory:');
    runMigrations(db, infraOpsMigrations);
    const repository = new AlertDispatchRepository(db);

    repository.recordSent('disk_usage', new Date('2026-08-30T12:00:00.000Z'));
    repository.recordSent('disk_usage', new Date('2026-08-30T13:00:00.000Z'));

    const count = db.prepare('SELECT COUNT(*) as c FROM infra_ops_alert_dispatches').get() as { c: number };
    expect(count.c).toBe(1);
    expect(repository.findLastSentAt('disk_usage')?.toISOString()).toBe('2026-08-30T13:00:00.000Z');
  });

  it('down remove a tabela (down testado)', () => {
    const db = new Database(':memory:');
    runMigrations(db, infraOpsMigrations);

    const migration = infraOpsMigrations.find((m) => m.id === '001_infra_ops_alert_dispatches');
    expect(migration).toBeDefined();
    rollbackMigration(db, migration!);

    expect(() => db.prepare('SELECT * FROM infra_ops_alert_dispatches').get()).toThrow();
  });
});
