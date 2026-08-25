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
  it('grava a primeira mensagem com um wa_message_id novo, já como pending (ADR-018)', () => {
    const { db, repository } = buildRepository();

    const result = repository.tryRecordInbound({ jid: 'jid-1', waMessageId: 'wa-1', body: 'oi' });

    expect(result).toEqual({ isNew: true, messageId: expect.any(Number) });
    const row = db.prepare('SELECT processing_status FROM messages WHERE id = ?').get(
      (result as { messageId: number }).messageId,
    ) as { processing_status: string };
    expect(row.processing_status).toBe('pending');
  });

  it('deduplica reentrega do mesmo wa_message_id', () => {
    const { repository } = buildRepository();
    repository.tryRecordInbound({ jid: 'jid-1', waMessageId: 'wa-1', body: 'oi' });

    const result = repository.tryRecordInbound({ jid: 'jid-1', waMessageId: 'wa-1', body: 'oi' });

    expect(result).toEqual({ isNew: false });
  });

  it('rejeita (fail-closed) mensagem sem wa_message_id em vez de gravar sem dedup possível', () => {
    const { db, repository } = buildRepository();

    const result = repository.tryRecordInbound({ jid: 'jid-1', waMessageId: undefined, body: 'oi' });

    expect(result).toEqual({ isNew: false });
    const count = db.prepare('SELECT COUNT(*) as c FROM messages').get() as { c: number };
    expect(count.c).toBe(0);
  });

  it('permite duas mensagens distintas sem colidir uma com a outra', () => {
    const { repository } = buildRepository();

    expect(repository.tryRecordInbound({ jid: 'jid-1', waMessageId: 'wa-1', body: 'a' }).isNew).toBe(true);
    expect(repository.tryRecordInbound({ jid: 'jid-1', waMessageId: 'wa-2', body: 'b' }).isNew).toBe(true);
  });

  it('recordLlmUsage grava tokens_in/tokens_out/cache_read_tokens (RF-15)', () => {
    const { db, repository } = buildRepository();

    repository.recordLlmUsage({ jid: 'jid-1', intent: 'triagem', tokensIn: 120, tokensOut: 40, cacheReadTokens: 90 });

    const row = db
      .prepare('SELECT direction, intent, tokens_in, tokens_out, cache_read_tokens FROM messages')
      .get() as { direction: string; intent: string; tokens_in: number; tokens_out: number; cache_read_tokens: number };
    expect(row).toEqual({ direction: 'in', intent: 'triagem', tokens_in: 120, tokens_out: 40, cache_read_tokens: 90 });
  });

  it('markProcessed transiciona pending -> processed', () => {
    const { db, repository } = buildRepository();
    const result = repository.tryRecordInbound({ jid: 'jid-1', waMessageId: 'wa-1', body: 'oi' });
    const messageId = (result as { messageId: number }).messageId;

    repository.markProcessed(messageId);

    const row = db.prepare('SELECT processing_status FROM messages WHERE id = ?').get(messageId) as {
      processing_status: string;
    };
    expect(row.processing_status).toBe('processed');
  });

  it('markFailed transiciona pending -> failed', () => {
    const { db, repository } = buildRepository();
    const result = repository.tryRecordInbound({ jid: 'jid-1', waMessageId: 'wa-1', body: 'oi' });
    const messageId = (result as { messageId: number }).messageId;

    repository.markFailed(messageId);

    const row = db.prepare('SELECT processing_status FROM messages WHERE id = ?').get(messageId) as {
      processing_status: string;
    };
    expect(row.processing_status).toBe('failed');
  });

  it('findPendingInbound só retorna mensagens de entrada ainda pending', () => {
    const { repository } = buildRepository();
    const first = repository.tryRecordInbound({ jid: 'jid-1', waMessageId: 'wa-1', body: 'a' });
    repository.tryRecordInbound({ jid: 'jid-1', waMessageId: 'wa-2', body: 'b' });
    repository.markProcessed((first as { messageId: number }).messageId);
    repository.recordOutbound('jid-1', 'resposta'); // out nunca deveria aparecer aqui

    const pending = repository.findPendingInbound();

    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ jid: 'jid-1', body: 'b' });
  });
});
