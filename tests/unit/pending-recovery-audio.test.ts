import { describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/core/db/migrator.js';
import { coreMigrations } from '../../src/core/db/migrations/index.js';
import { MessageRepository } from '../../src/core/channel/message-repository.js';
import { OutboxRepository } from '../../src/core/outbox/index.js';
import { recoverPendingMessages } from '../../src/core/channel/whatsapp-evolution/pending-recovery.js';
import { MediaUnavailableError } from '../../src/core/channel/whatsapp-evolution/evolution-client.js';
import { createLogger } from '../../src/core/logger.js';

const JID = '5511999999999@s.whatsapp.net';
const OLD_TIMESTAMP = '2000-01-01 00:00:00';
const NOW = new Date('2026-08-25T13:00:00.000Z');
const THRESHOLD_MS = 60_000;
const MAX_PER_BOOT = 50;

function buildContext() {
  const db = new Database(':memory:');
  runMigrations(db, coreMigrations);
  const messageRepository = new MessageRepository(db);
  const outboxRepository = new OutboxRepository(db);
  const logger = createLogger('test');
  return { db, messageRepository, outboxRepository, logger };
}

function insertStaleAudioMessage(db: Database.Database, waMessageId: string, recoveryData?: unknown): void {
  db.prepare(
    `INSERT INTO messages (direction, wa_message_id, jid, body, processing_status, media_type, message_key_json, created_at)
     VALUES ('in', ?, ?, NULL, 'pending', 'audio', ?, ?)`,
  ).run(waMessageId, JID, recoveryData ? JSON.stringify(recoveryData) : null, OLD_TIMESTAMP);
}

describe('recoverPendingMessages — casos de borda de áudio (FEAT-003, spec item 4)', () => {
  it('sem onAudioRecovery configurado: marca processed sem tentar reprocessar', async () => {
    const { db, messageRepository, outboxRepository, logger } = buildContext();
    insertStaleAudioMessage(db, 'wa-audio-sem-handler', { messageKey: { id: 'x' }, mimeType: 'audio/ogg' });

    await recoverPendingMessages(
      { messageRepository, ownerJid: JID, commands: [], outboxRepository, logger, now: () => NOW },
      THRESHOLD_MS,
      MAX_PER_BOOT,
    );

    const row = db.prepare(`SELECT processing_status FROM messages WHERE wa_message_id = 'wa-audio-sem-handler'`).get() as {
      processing_status: string;
    };
    expect(row.processing_status).toBe('processed');
  });

  it('sem audioRecoveryData persistido (payload degradado): marca processed sem chamar o handler', async () => {
    const { db, messageRepository, outboxRepository, logger } = buildContext();
    insertStaleAudioMessage(db, 'wa-audio-sem-recovery-data', undefined);
    const onAudioRecovery = vi.fn(async () => undefined);

    await recoverPendingMessages(
      { messageRepository, ownerJid: JID, commands: [], outboxRepository, logger, onAudioRecovery, now: () => NOW },
      THRESHOLD_MS,
      MAX_PER_BOOT,
    );

    expect(onAudioRecovery).not.toHaveBeenCalled();
    const row = db
      .prepare(`SELECT processing_status FROM messages WHERE wa_message_id = 'wa-audio-sem-recovery-data'`)
      .get() as { processing_status: string };
    expect(row.processing_status).toBe('processed');
  });

  it('onAudioRecovery lança MediaUnavailableError: marca processed (nunca failed)', async () => {
    const { db, messageRepository, outboxRepository, logger } = buildContext();
    insertStaleAudioMessage(db, 'wa-audio-expirado', { messageKey: { id: 'x' }, mimeType: 'audio/ogg' });
    const onAudioRecovery = vi.fn(async () => {
      throw new MediaUnavailableError();
    });

    await recoverPendingMessages(
      { messageRepository, ownerJid: JID, commands: [], outboxRepository, logger, onAudioRecovery, now: () => NOW },
      THRESHOLD_MS,
      MAX_PER_BOOT,
    );

    const row = db.prepare(`SELECT processing_status FROM messages WHERE wa_message_id = 'wa-audio-expirado'`).get() as {
      processing_status: string;
    };
    expect(row.processing_status).toBe('processed');
  });

  it('onAudioRecovery lança erro genérico (não MediaUnavailableError): marca failed e loga', async () => {
    const { db, messageRepository, outboxRepository, logger } = buildContext();
    const errorSpy = vi.spyOn(logger, 'error');
    insertStaleAudioMessage(db, 'wa-audio-falha-generica', { messageKey: { id: 'x' }, mimeType: 'audio/ogg' });
    const onAudioRecovery = vi.fn(async () => {
      throw new Error('bug inesperado, não relacionado a mídia');
    });

    await recoverPendingMessages(
      { messageRepository, ownerJid: JID, commands: [], outboxRepository, logger, onAudioRecovery, now: () => NOW },
      THRESHOLD_MS,
      MAX_PER_BOOT,
    );

    const row = db.prepare(`SELECT processing_status FROM messages WHERE wa_message_id = 'wa-audio-falha-generica'`).get() as {
      processing_status: string;
    };
    expect(row.processing_status).toBe('failed');
    expect(errorSpy).toHaveBeenCalled();
  });

  it('onAudioRecovery com sucesso: marca processed e passa jid/messageId corretos', async () => {
    const { db, messageRepository, outboxRepository, logger } = buildContext();
    insertStaleAudioMessage(db, 'wa-audio-ok', { messageKey: { id: 'chave-original' }, mimeType: 'audio/ogg' });
    const onAudioRecovery = vi.fn(async () => undefined);

    await recoverPendingMessages(
      { messageRepository, ownerJid: JID, commands: [], outboxRepository, logger, onAudioRecovery, now: () => NOW },
      THRESHOLD_MS,
      MAX_PER_BOOT,
    );

    expect(onAudioRecovery).toHaveBeenCalledWith(
      { messageKey: { id: 'chave-original' }, mimeType: 'audio/ogg' },
      JID,
      expect.any(Number),
    );
    const row = db.prepare(`SELECT processing_status FROM messages WHERE wa_message_id = 'wa-audio-ok'`).get() as {
      processing_status: string;
    };
    expect(row.processing_status).toBe('processed');
  });
});
