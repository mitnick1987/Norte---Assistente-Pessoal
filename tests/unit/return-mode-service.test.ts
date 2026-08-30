import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/core/db/migrator.js';
import { coreMigrations } from '../../src/core/db/migrations/index.js';
import { tasksMigrations } from '../../src/modules/tasks/migrations/index.js';
import { MessageRepository } from '../../src/core/channel/index.js';
import { ItemsRepository } from '../../src/modules/tasks/items-repository.js';
import { ItemService } from '../../src/modules/tasks/item-service.js';
import { ReturnModeService } from '../../src/modules/return-mode/return-mode-service.js';

const OWNER_JID = '5511999999999@s.whatsapp.net';

function buildContext(now: Date) {
  const db = new Database(':memory:');
  runMigrations(db, [...coreMigrations, ...tasksMigrations]);
  const messageRepository = new MessageRepository(db);
  const itemService = new ItemService(new ItemsRepository(db), () => now);
  const service = new ReturnModeService({ messageRepository, itemService, now: () => now });
  return { db, messageRepository, itemService, service };
}

describe('ReturnModeService (RF-10)', () => {
  it('isSuppressed é falso sem nenhuma mensagem de entrada anterior', () => {
    const { service } = buildContext(new Date('2026-08-30T12:00:00.000Z'));

    expect(service.isSuppressed(OWNER_JID)).toBe(false);
  });

  it('isSuppressed é falso quando a última entrada foi há menos de 48h', () => {
    const now = new Date('2026-08-30T12:00:00.000Z');
    const { messageRepository, service } = buildContext(now);
    messageRepository.tryRecordInbound({ jid: OWNER_JID, waMessageId: 'wa-1', body: 'oi' });

    expect(service.isSuppressed(OWNER_JID)).toBe(false);
  });

  it('checkReentry devolve undefined quando não há silêncio de 48h (não é reativação)', () => {
    const now = new Date('2026-08-30T12:00:00.000Z');
    const { messageRepository, service } = buildContext(now);
    const first = messageRepository.tryRecordInbound({ jid: OWNER_JID, waMessageId: 'wa-1', body: 'oi' });
    const second = messageRepository.tryRecordInbound({ jid: OWNER_JID, waMessageId: 'wa-2', body: 'de novo' });
    void first;

    const summary = service.checkReentry(OWNER_JID, (second as { messageId: number }).messageId);

    expect(summary).toBeUndefined();
  });

  it('checkReentry devolve o resumo quando a mensagem anterior está há 48h+ (reativação)', () => {
    const db = new Database(':memory:');
    runMigrations(db, [...coreMigrations, ...tasksMigrations]);
    const messageRepository = new MessageRepository(db);
    const itemService = new ItemService(new ItemsRepository(db), () => new Date('2026-08-25T12:00:00.000Z'));

    // primeira mensagem, 3 dias atrás
    const first = messageRepository.tryRecordInbound({ jid: OWNER_JID, waMessageId: 'wa-1', body: 'oi' });
    db.prepare(`UPDATE messages SET created_at = '2026-08-25 12:00:00' WHERE id = ?`).run(
      (first as { messageId: number }).messageId,
    );

    // mensagem de reativação, agora
    const nowReactivation = new Date('2026-08-28T13:00:00.000Z');
    const second = messageRepository.tryRecordInbound({ jid: OWNER_JID, waMessageId: 'wa-2', body: 'voltei' });
    db.prepare(`UPDATE messages SET created_at = '2026-08-28 13:00:00' WHERE id = ?`).run(
      (second as { messageId: number }).messageId,
    );

    const service = new ReturnModeService({ messageRepository, itemService, now: () => nowReactivation });
    const summary = service.checkReentry(OWNER_JID, (second as { messageId: number }).messageId);

    expect(summary).toBeDefined();
  });

  it('resumo de reentrada nunca lista as cobranças acumuladas item a item, só a contagem agregada', () => {
    const db = new Database(':memory:');
    runMigrations(db, [...coreMigrations, ...tasksMigrations]);
    const messageRepository = new MessageRepository(db);
    const itemService = new ItemService(new ItemsRepository(db), () => new Date('2026-08-25T12:00:00.000Z'));
    itemService.create({ type: 'tarefa', title: 'pagar boleto vencido', origin: 'texto' });
    itemService.create({ type: 'tarefa', title: 'ligar pro dentista', origin: 'texto' });

    const first = messageRepository.tryRecordInbound({ jid: OWNER_JID, waMessageId: 'wa-1', body: 'oi' });
    db.prepare(`UPDATE messages SET created_at = '2026-08-25 12:00:00' WHERE id = ?`).run(
      (first as { messageId: number }).messageId,
    );
    const nowReactivation = new Date('2026-08-28T13:00:00.000Z');
    const second = messageRepository.tryRecordInbound({ jid: OWNER_JID, waMessageId: 'wa-2', body: 'voltei' });
    db.prepare(`UPDATE messages SET created_at = '2026-08-28 13:00:00' WHERE id = ?`).run(
      (second as { messageId: number }).messageId,
    );

    const service = new ReturnModeService({ messageRepository, itemService, now: () => nowReactivation });
    const summary = service.checkReentry(OWNER_JID, (second as { messageId: number }).messageId);

    expect(summary).toBeDefined();
    expect(summary).not.toContain('pagar boleto vencido');
    expect(summary).not.toContain('ligar pro dentista');
  });
});
