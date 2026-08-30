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
    repository.recordOutbound('jid-1', 'resposta', false); // out nunca deveria aparecer aqui

    const pending = repository.findPendingInbound();

    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ jid: 'jid-1', body: 'b' });
  });

  it('grava mensagem de áudio com media_type e audioRecoveryData (FEAT-003)', () => {
    const { db, repository } = buildRepository();

    const result = repository.tryRecordInbound({
      jid: 'jid-1',
      waMessageId: 'wa-audio-1',
      body: undefined,
      mediaType: 'audio',
      audioRecoveryData: { messageKey: { id: 'wa-audio-1', remoteJid: 'jid-1' }, mimeType: 'audio/ogg' },
    });
    const messageId = (result as { messageId: number }).messageId;

    const row = db.prepare('SELECT media_type FROM messages WHERE id = ?').get(messageId) as { media_type: string };
    expect(row.media_type).toBe('audio');

    const pending = repository.findPendingInbound();
    expect(pending[0]?.mediaType).toBe('audio');
    expect(pending[0]?.audioRecoveryData).toEqual({
      messageKey: { id: 'wa-audio-1', remoteJid: 'jid-1' },
      mimeType: 'audio/ogg',
    });
  });

  it('mensagem de texto não grava audioRecoveryData', () => {
    const { repository } = buildRepository();
    repository.tryRecordInbound({ jid: 'jid-1', waMessageId: 'wa-1', body: 'oi' });

    const pending = repository.findPendingInbound();

    expect(pending[0]?.mediaType).toBeNull();
    expect(pending[0]?.audioRecoveryData).toBeUndefined();
  });

  it('message_key_json corrompido (JSON inválido) não derruba findPendingInbound — trata como dado ausente', () => {
    const { db, repository } = buildRepository();
    db.prepare(
      `INSERT INTO messages (direction, wa_message_id, jid, processing_status, media_type, message_key_json)
       VALUES ('in', 'wa-audio-corrompido', 'jid-1', 'pending', 'audio', 'isso não é json')`,
    ).run();

    const pending = repository.findPendingInbound();

    expect(pending[0]?.audioRecoveryData).toBeUndefined();
  });

  it('message_key_json com formato inesperado (sem mimeType) é tratado como dado ausente', () => {
    const { db, repository } = buildRepository();
    db.prepare(
      `INSERT INTO messages (direction, wa_message_id, jid, processing_status, media_type, message_key_json)
       VALUES ('in', 'wa-audio-incompleto', 'jid-1', 'pending', 'audio', '{"messageKey":{}}')`,
    ).run();

    const pending = repository.findPendingInbound();

    expect(pending[0]?.audioRecoveryData).toBeUndefined();
  });

  it('recordTranscription grava o texto transcrito na coluna transcricao (spec item 2)', () => {
    const { db, repository } = buildRepository();
    const result = repository.tryRecordInbound({
      jid: 'jid-1',
      waMessageId: 'wa-audio-1',
      body: undefined,
      mediaType: 'audio',
      audioRecoveryData: { messageKey: { id: 'x' }, mimeType: 'audio/ogg' },
    });
    const messageId = (result as { messageId: number }).messageId;

    repository.recordTranscription(messageId, 'lembra de comprar ração amanhã');

    const row = db.prepare('SELECT transcricao FROM messages WHERE id = ?').get(messageId) as {
      transcricao: string;
    };
    expect(row.transcricao).toBe('lembra de comprar ração amanhã');
  });

  describe('findRecentConversation (FEAT-006 item 4)', () => {
    it('inclui turnos reais de entrada e saída, na ordem cronológica', () => {
      const { repository } = buildRepository();
      repository.tryRecordInbound({ jid: 'jid-1', waMessageId: 'wa-1', body: 'oi, marca reunião sexta' });
      repository.recordOutbound('jid-1', 'marquei pra sexta às 10h', false);

      const conversation = repository.findRecentConversation('jid-1', 20);

      expect(conversation).toEqual([
        { direction: 'in', body: 'oi, marca reunião sexta' },
        { direction: 'out', body: 'marquei pra sexta às 10h' },
      ]);
    });

    it('exclui mensagem proativa (briefing/revisão/lembrete) da janela — não é turno de conversa', () => {
      const { repository } = buildRepository();
      repository.tryRecordInbound({ jid: 'jid-1', waMessageId: 'wa-1', body: 'oi' });
      repository.recordOutbound('jid-1', 'oi, tudo bem?', false);
      repository.recordOutbound('jid-1', 'bom dia! hoje você tem 3 compromissos...', true); // briefing

      const conversation = repository.findRecentConversation('jid-1', 20);

      expect(conversation).toEqual([
        { direction: 'in', body: 'oi' },
        { direction: 'out', body: 'oi, tudo bem?' },
      ]);
      expect(conversation.map((m) => m.body)).not.toContain('bom dia! hoje você tem 3 compromissos...');
    });

    it('exclui linha de recordLlmUsage (sem body) e mensagem de outro jid', () => {
      const { repository } = buildRepository();
      repository.tryRecordInbound({ jid: 'jid-1', waMessageId: 'wa-1', body: 'oi' });
      repository.recordLlmUsage({ jid: 'jid-1', intent: 'triagem', tokensIn: 10, tokensOut: 5, cacheReadTokens: 0 });
      repository.tryRecordInbound({ jid: 'jid-2', waMessageId: 'wa-2', body: 'mensagem de outro contato' });

      const conversation = repository.findRecentConversation('jid-1', 20);

      expect(conversation).toEqual([{ direction: 'in', body: 'oi' }]);
    });
  });
});
