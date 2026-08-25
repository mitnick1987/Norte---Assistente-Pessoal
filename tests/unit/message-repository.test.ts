import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/core/db/migrator.js';
import { coreMigrations } from '../../src/core/db/migrations/index.js';
import { MessageRepository } from '../../src/core/channel/message-repository.js';

function buildRepository(): { db: Database.Database; repository: MessageRepository } {
  const db = new Database(':memory:');
  runMigrations(db, coreMigrations);
  return { db, repository: new MessageRepository(db) };
}

describe('MessageRepository', () => {
  it('grava a primeira mensagem com um wa_message_id novo', () => {
    const { repository } = buildRepository();

    const isNew = repository.tryRecordInbound({ jid: 'jid-1', waMessageId: 'wa-1', body: 'oi' });

    expect(isNew).toBe(true);
  });

  it('deduplica reentrega do mesmo wa_message_id', () => {
    const { repository } = buildRepository();
    repository.tryRecordInbound({ jid: 'jid-1', waMessageId: 'wa-1', body: 'oi' });

    const isNew = repository.tryRecordInbound({ jid: 'jid-1', waMessageId: 'wa-1', body: 'oi' });

    expect(isNew).toBe(false);
  });

  it('rejeita (fail-closed) mensagem sem wa_message_id em vez de gravar sem dedup possível', () => {
    const { db, repository } = buildRepository();

    const isNew = repository.tryRecordInbound({ jid: 'jid-1', waMessageId: undefined, body: 'oi' });

    expect(isNew).toBe(false);
    const count = db.prepare('SELECT COUNT(*) as c FROM messages').get() as { c: number };
    expect(count.c).toBe(0);
  });

  it('permite duas mensagens distintas sem colidir uma com a outra', () => {
    const { repository } = buildRepository();

    expect(repository.tryRecordInbound({ jid: 'jid-1', waMessageId: 'wa-1', body: 'a' })).toBe(true);
    expect(repository.tryRecordInbound({ jid: 'jid-1', waMessageId: 'wa-2', body: 'b' })).toBe(true);
  });
});
