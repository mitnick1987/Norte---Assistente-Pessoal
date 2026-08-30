import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/core/db/migrator.js';
import { coreMigrations } from '../../src/core/db/migrations/index.js';
import { tasksMigrations } from '../../src/modules/tasks/migrations/index.js';
import { nudgesMigrations } from '../../src/modules/nudges/migrations/index.js';
import { ItemsRepository } from '../../src/modules/tasks/items-repository.js';
import { ItemService } from '../../src/modules/tasks/item-service.js';
import { OutboxRepository } from '../../src/core/outbox/index.js';
import { MessageRepository } from '../../src/core/channel/index.js';
import { ChargesRepository } from '../../src/modules/nudges/charges-repository.js';
import { PatternsRepository } from '../../src/modules/nudges/patterns-repository.js';
import { NudgeService } from '../../src/modules/nudges/nudge-service.js';
import { ReturnModeService } from '../../src/modules/return-mode/return-mode-service.js';

const OWNER_JID = '5511999999999@s.whatsapp.net';
const noopLogger = { info: () => undefined, warn: () => undefined, error: () => undefined } as never;

function buildContext(now: Date) {
  const db = new Database(':memory:');
  runMigrations(db, [...coreMigrations, ...tasksMigrations, ...nudgesMigrations]);

  const itemService = new ItemService(new ItemsRepository(db), () => now);
  const outboxRepository = new OutboxRepository(db);
  const messageRepository = new MessageRepository(db);
  const chargesRepository = new ChargesRepository(db);
  const patternsRepository = new PatternsRepository(db);
  const returnModeService = new ReturnModeService({ messageRepository, itemService, now: () => now });

  const service = new NudgeService({
    itemService,
    chargesRepository,
    patternsRepository,
    outboxRepository,
    returnModeService,
    ownerJid: OWNER_JID,
    logger: noopLogger,
    getDailyChargeCap: () => 3,
    getFallbackSnoozeHour: () => 9,
    getFallbackSnoozeMinute: () => 0,
    now: () => now,
  });

  return { db, itemService, outboxRepository, chargesRepository, patternsRepository, service };
}

describe('NudgeService.checkAndSendDue (RF-08, fechamento de loop)', () => {
  it('item vencido gera mensagem de cobrança no outbox com o menu completo', async () => {
    const now = new Date('2026-08-30T15:00:00.000Z');
    const { itemService, outboxRepository, service } = buildContext(now);
    itemService.create({ type: 'tarefa', title: 'pagar boleto', origin: 'texto', dueAt: new Date('2026-08-30T10:00:00.000Z') });

    await service.checkAndSendDue();

    const rows = outboxRepository.findPending(now.toISOString());
    expect(rows).toHaveLength(1);
    expect(rows[0]!.body).toContain('1) feito');
  });

  it('nunca cobra o mesmo item duas vezes no mesmo dia', async () => {
    const now = new Date('2026-08-30T15:00:00.000Z');
    const { itemService, outboxRepository, service } = buildContext(now);
    itemService.create({ type: 'tarefa', title: 'pagar boleto', origin: 'texto', dueAt: new Date('2026-08-30T10:00:00.000Z') });

    await service.checkAndSendDue();
    await service.checkAndSendDue();

    expect(outboxRepository.findPending(now.toISOString())).toHaveLength(1);
  });

  it('teto diário de cobranças bloqueia disparo além do limite configurado', async () => {
    const now = new Date('2026-08-30T15:00:00.000Z');
    const { itemService, outboxRepository, service } = buildContext(now);
    for (let i = 0; i < 5; i++) {
      itemService.create({
        type: 'tarefa',
        title: `tarefa ${i}`,
        origin: 'texto',
        dueAt: new Date('2026-08-30T10:00:00.000Z'),
      });
    }

    await service.checkAndSendDue();

    expect(outboxRepository.findPending(now.toISOString())).toHaveLength(3); // dailyChargeCap = 3
  });

  it('supressor do modo retorno ativo bloqueia todo disparo', async () => {
    const now = new Date('2026-08-30T15:00:00.000Z');
    const { db, itemService, outboxRepository, service } = buildContext(now);
    itemService.create({ type: 'tarefa', title: 'pagar boleto', origin: 'texto', dueAt: new Date('2026-08-30T10:00:00.000Z') });
    // simula silêncio >= 48h: última mensagem de entrada há 3 dias
    db.prepare(
      `INSERT INTO messages (direction, wa_message_id, jid, body, created_at) VALUES ('in', 'wa-1', ?, 'oi', '2026-08-27 10:00:00')`,
    ).run(OWNER_JID);

    await service.checkAndSendDue();

    expect(outboxRepository.findPending(now.toISOString())).toHaveLength(0);
  });
});

describe('NudgeService: resolução do menu 1/2/3', () => {
  it('findPendingChargeItemId devolve undefined sem cobrança pendente', () => {
    const { service } = buildContext(new Date('2026-08-30T15:00:00.000Z'));

    expect(service.findPendingChargeItemId()).toBeUndefined();
  });

  it('findPendingChargeItemId devolve o item da cobrança mais recente ainda sem resposta', async () => {
    const now = new Date('2026-08-30T15:00:00.000Z');
    const { itemService, service } = buildContext(now);
    const item = itemService.create({
      type: 'tarefa',
      title: 'pagar boleto',
      origin: 'texto',
      dueAt: new Date('2026-08-30T10:00:00.000Z'),
    });

    await service.checkAndSendDue();

    expect(service.findPendingChargeItemId()).toBe(item.id);
  });

  it('recordResponse marca a cobrança como respondida — deixa de ser a pendente', async () => {
    const now = new Date('2026-08-30T15:00:00.000Z');
    const { itemService, service } = buildContext(now);
    itemService.create({ type: 'tarefa', title: 'pagar boleto', origin: 'texto', dueAt: new Date('2026-08-30T10:00:00.000Z') });
    await service.checkAndSendDue();

    service.recordResponse();

    expect(service.findPendingChargeItemId()).toBeUndefined();
  });

  it('applyReschedule move o due_at do item para a proposta calculada (fallback de settings)', async () => {
    const now = new Date('2026-08-30T15:00:00.000Z');
    const { db, itemService, service } = buildContext(now);
    const item = itemService.create({
      type: 'tarefa',
      title: 'pagar boleto',
      origin: 'texto',
      dueAt: new Date('2026-08-30T10:00:00.000Z'),
    });
    await service.checkAndSendDue();

    const reply = await service.applyReschedule(item.id);

    expect(reply.toLowerCase()).not.toContain('para quando');
    const row = db.prepare('SELECT due_at, status FROM items WHERE id = ?').get(item.id) as {
      due_at: string;
      status: string;
    };
    expect(row.status).toBe('adiada');
    expect(new Date(row.due_at).getTime()).toBeGreaterThan(now.getTime());
  });
});
