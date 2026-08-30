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
import { buildChargeMessage, buildRescheduleMessage, buildRescheduleProposal } from '../../src/modules/nudges/domain/index.js';
import { buildReentrySummaryMessage } from '../../src/modules/return-mode/domain/index.js';
import { buildHygieneMessage, buildHygieneProposal } from '../../src/modules/hygiene/domain/index.js';
import { assertToneIsSafe } from './forbidden-patterns.js';

const OWNER_JID = '5511999999999@s.whatsapp.net';
const NOW = new Date('2026-08-30T15:00:00.000Z');
const noopLogger = { info: () => undefined, warn: () => undefined, error: () => undefined } as never;

/**
 * Suite de TOM (RF-14, TESTING.md §4.1) das mensagens novas desta entrega:
 * cobrança 1/2/3, proposta de reagendamento, resumo de reentrada e proposta
 * de higiene. Todas 100% determinísticas (spec, Decisões tomadas) — sem
 * depender do Sonnet, testáveis por código.
 */
describe('suite de tom — mensagem de cobrança (RF-08)', () => {
  it('passa no filtro de tom em várias variações de seed (id do item)', () => {
    for (let id = 1; id <= 10; id++) {
      assertToneIsSafe(buildChargeMessage({ id, title: `tarefa ${id}` }));
    }
  });

  it('sempre oferece "dropar" no menu (spec item 6)', () => {
    for (let id = 1; id <= 10; id++) {
      expect(buildChargeMessage({ id, title: `tarefa ${id}` })).toContain('dropar');
    }
  });
});

describe('suite de tom — proposta de reagendamento (RF-08)', () => {
  it('nunca pergunta "para quando?" e passa no filtro de tom', () => {
    const withPattern = buildRescheduleProposal([{ weekday: 6, hour: 9 }], { hour: 9, minute: 0 }, NOW);
    const withFallback = buildRescheduleProposal([], { hour: 9, minute: 0 }, NOW);

    for (const proposal of [withPattern, withFallback]) {
      const message = buildRescheduleMessage(proposal);
      assertToneIsSafe(message);
      expect(message.toLowerCase()).not.toContain('para quando');
    }
  });
});

describe('suite de tom — resumo de reentrada (RF-10)', () => {
  it('passa no filtro de tom com e sem itens pendentes', () => {
    assertToneIsSafe(buildReentrySummaryMessage({ silentDays: 3, pendingCount: 5 }));
    assertToneIsSafe(buildReentrySummaryMessage({ silentDays: 10, pendingCount: 0 }));
  });

  it('nunca pede "colocar em dia"', () => {
    for (let silentDays = 0; silentDays < 10; silentDays++) {
      const message = buildReentrySummaryMessage({ silentDays, pendingCount: 4 });
      expect(message.toLowerCase()).not.toContain('colocar em dia');
    }
  });

  it('nunca lista cobranças acumuladas item a item — só a contagem agregada', () => {
    const message = buildReentrySummaryMessage({ silentDays: 3, pendingCount: 4 });

    expect(message).not.toMatch(/^-\s/m);
  });
});

describe('suite de tom — proposta de higiene (RF-11)', () => {
  it('passa no filtro de tom e nunca soa como fracasso', () => {
    const proposal = buildHygieneProposal({ id: 1, title: 'projeto parado', snoozeCount: 5, updatedAt: '2026-01-01T00:00:00.000Z' }, NOW);
    const message = buildHygieneMessage(proposal, proposal.itemId);

    assertToneIsSafe(message);
  });

  it('sempre oferece arquivar/dropar/adiar, nunca "quebrar essa tarefa"', () => {
    const proposal = buildHygieneProposal({ id: 1, title: 'projeto parado', snoozeCount: 5, updatedAt: '2026-01-01T00:00:00.000Z' }, NOW);
    const message = buildHygieneMessage(proposal, proposal.itemId);

    expect(message).toContain('arquivar');
    expect(message).toContain('dropar');
    expect(message).toContain('adiar');
    expect(message.toLowerCase()).not.toContain('quebrar');
  });
});

describe('cenário: 48h de silêncio com múltiplos itens vencidos gera NO MÁXIMO 1 mensagem proativa na volta (TESTING.md §4.1)', () => {
  it('mensagem de entrada após silêncio enfileira só o resumo, nunca cobranças acumuladas', async () => {
    const db = new Database(':memory:');
    runMigrations(db, [...coreMigrations, ...tasksMigrations, ...nudgesMigrations]);

    const itemService = new ItemService(new ItemsRepository(db), () => new Date('2026-08-25T12:00:00.000Z'));
    const outboxRepository = new OutboxRepository(db);
    const messageRepository = new MessageRepository(db);
    const chargesRepository = new ChargesRepository(db);
    const patternsRepository = new PatternsRepository(db);

    // vários itens vencidos ANTES do silêncio começar
    itemService.create({ type: 'tarefa', title: 'pagar boleto', origin: 'texto', dueAt: new Date('2026-08-24T09:00:00.000Z') });
    itemService.create({ type: 'tarefa', title: 'ligar dentista', origin: 'texto', dueAt: new Date('2026-08-24T10:00:00.000Z') });
    itemService.create({ type: 'tarefa', title: 'revisar contrato', origin: 'texto', dueAt: new Date('2026-08-24T11:00:00.000Z') });

    // primeira (e última) mensagem de entrada antes do silêncio começar
    const first = messageRepository.tryRecordInbound({ jid: OWNER_JID, waMessageId: 'wa-1', body: 'oi' });
    db.prepare(`UPDATE messages SET created_at = '2026-08-25 12:00:00' WHERE id = ?`).run(
      (first as { messageId: number }).messageId,
    );

    // 3 dias depois (silêncio >= 48h): o job de cobrança roda, mas o modo
    // retorno já está ativo — nenhuma cobrança sai, mesmo com itens vencidos.
    const duringSilenceNow = new Date('2026-08-28T12:00:00.000Z');
    const returnModeServiceDuringSilence = new ReturnModeService({ messageRepository, itemService, now: () => duringSilenceNow });
    const nudgeServiceDuringSilence = new NudgeService({
      itemService,
      chargesRepository,
      patternsRepository,
      outboxRepository,
      returnModeService: returnModeServiceDuringSilence,
      ownerJid: OWNER_JID,
      logger: noopLogger,
      getDailyChargeCap: () => 3,
      getFallbackSnoozeHour: () => 9,
      getFallbackSnoozeMinute: () => 0,
      now: () => duringSilenceNow,
    });

    await nudgeServiceDuringSilence.checkAndSendDue();
    expect(outboxRepository.findPending(duringSilenceNow.toISOString())).toHaveLength(0);

    // reativação: mensagem de entrada 4 dias depois (>= 48h de silêncio)
    const reactivationNow = new Date('2026-08-29T13:00:00.000Z');
    const returnModeServiceAtReactivation = new ReturnModeService({ messageRepository, itemService, now: () => reactivationNow });
    const second = messageRepository.tryRecordInbound({ jid: OWNER_JID, waMessageId: 'wa-2', body: 'voltei' });
    db.prepare(`UPDATE messages SET created_at = '2026-08-29 13:00:00' WHERE id = ?`).run(
      (second as { messageId: number }).messageId,
    );

    const reentryMessage = returnModeServiceAtReactivation.checkReentry(OWNER_JID, (second as { messageId: number }).messageId);
    expect(reentryMessage).toBeDefined();
    if (reentryMessage) outboxRepository.enqueue({ jid: OWNER_JID, body: reentryMessage, isProactive: true });

    const proactiveMessages = outboxRepository.findPending(reactivationNow.toISOString());
    expect(proactiveMessages).toHaveLength(1);
    expect(proactiveMessages[0]!.body).not.toContain('pagar boleto');
    expect(proactiveMessages[0]!.body).not.toContain('ligar dentista');
    expect(proactiveMessages[0]!.body).not.toContain('revisar contrato');
  });
});
