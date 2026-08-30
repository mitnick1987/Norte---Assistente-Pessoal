import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/core/db/migrator.js';
import { coreMigrations } from '../../src/core/db/migrations/index.js';
import { OutboxRepository } from '../../src/core/outbox/outbox-repository.js';
import { startOfZonedDay, zonedTimeToUtc } from '../../src/core/scheduler/domain/timezone.js';

function buildRepository(): { db: Database.Database; repository: OutboxRepository } {
  const db = new Database(':memory:');
  runMigrations(db, coreMigrations);
  return { db, repository: new OutboxRepository(db) };
}

describe('OutboxRepository', () => {
  it('enfileira e encontra mensagem pendente', () => {
    const { repository } = buildRepository();
    const id = repository.enqueue({ jid: 'jid-1', body: 'oi' });

    const pending = repository.findPending(new Date().toISOString());

    expect(pending).toHaveLength(1);
    expect(pending[0]?.id).toBe(id);
    expect(pending[0]?.status).toBe('pending');
  });

  it('exclui da fila mensagens em backoff (retry_after no futuro)', () => {
    const { repository } = buildRepository();
    const id = repository.enqueue({ jid: 'jid-1', body: 'oi' });
    repository.markPendingForRetry(id, new Date(Date.now() + 60_000));

    const pending = repository.findPending(new Date().toISOString());

    expect(pending).toHaveLength(0);
  });

  it('inclui na fila mensagem cujo retry_after já passou', () => {
    const { repository } = buildRepository();
    const id = repository.enqueue({ jid: 'jid-1', body: 'oi' });
    repository.markPendingForRetry(id, new Date(Date.now() - 60_000));

    const pending = repository.findPending(new Date().toISOString());

    expect(pending.map((m) => m.id)).toContain(id);
  });

  it('conta somente proativas entregues dentro da janela informada', () => {
    const { repository } = buildRepository();

    const idOld = repository.enqueue({ jid: 'jid-1', body: 'antiga', isProactive: true });
    repository.markDelivered(idOld, new Date(Date.now() - 2 * 24 * 60 * 60 * 1000));

    const idRecent = repository.enqueue({ jid: 'jid-1', body: 'recente', isProactive: true });
    repository.markDelivered(idRecent, new Date());

    const idNonProactive = repository.enqueue({ jid: 'jid-1', body: 'reativa', isProactive: false });
    repository.markDelivered(idNonProactive, new Date());

    const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    expect(repository.countProactiveSentSince(sinceIso)).toBe(1);
  });

  it('incrementa attempts a cada chamada', () => {
    const { repository } = buildRepository();
    const id = repository.enqueue({ jid: 'jid-1', body: 'oi' });

    repository.incrementAttempts(id);
    repository.incrementAttempts(id);

    const pending = repository.findPending(new Date().toISOString());
    expect(pending[0]?.attempts).toBe(2);
  });

  it('markFailed tira a mensagem da fila de pendentes', () => {
    const { repository } = buildRepository();
    const id = repository.enqueue({ jid: 'jid-1', body: 'oi' });

    repository.markFailed(id);

    expect(repository.findPending(new Date().toISOString())).toHaveLength(0);
  });

  it('claimForSending transiciona mensagem pending para sending e retorna true', () => {
    const { db, repository } = buildRepository();
    const id = repository.enqueue({ jid: 'jid-1', body: 'oi' });

    const claimed = repository.claimForSending(id);

    expect(claimed).toBe(true);
    const row = db.prepare('SELECT status FROM outbox_messages WHERE id = ?').get(id) as { status: string };
    expect(row.status).toBe('sending');
  });

  it('claimForSending retorna false para mensagem que não está mais pending (claim perdido)', () => {
    const { repository } = buildRepository();
    const id = repository.enqueue({ jid: 'jid-1', body: 'oi' });
    repository.claimForSending(id);

    const secondClaim = repository.claimForSending(id);

    expect(secondClaim).toBe(false);
  });

  it('proativa entregue às 22h de ontem (SP) não conta no teto do dia civil de hoje de manhã', () => {
    const { repository } = buildRepository();

    // 22h de 25/08 em São Paulo == 2026-08-26T01:00:00.000Z.
    const yesterdayEveningSp = new Date('2026-08-26T01:00:00.000Z');
    const id = repository.enqueue({ jid: 'jid-1', body: 'briefing de ontem', isProactive: true });
    repository.markDelivered(id, yesterdayEveningSp);

    // agora é 07h de 26/08 em São Paulo (horário do briefing matinal).
    const nowSp = new Date('2026-08-26T10:00:00.000Z');
    const sinceIso = zonedTimeToUtc(startOfZonedDay(nowSp)).toISOString();

    expect(repository.countProactiveSentSince(sinceIso)).toBe(0);
  });

  it('findPending prioriza ritual-âncora (briefing/revisão) sobre proativa comum enfileirada antes (achado de review FEAT-006)', () => {
    const { repository } = buildRepository();

    const reminderId = repository.enqueue({ jid: 'jid-1', body: 'lembrete comum', isProactive: true });
    const briefingId = repository.enqueue({
      jid: 'jid-1',
      body: 'briefing de hoje',
      isProactive: true,
      isAnchorRitual: true,
    });

    const pending = repository.findPending(new Date().toISOString());

    expect(pending.map((m) => m.id)).toEqual([briefingId, reminderId]);
  });

  it('findPending mantém ordem de chegada entre mensagens do mesmo nível de prioridade', () => {
    const { repository } = buildRepository();

    const first = repository.enqueue({ jid: 'jid-1', body: 'primeira', isProactive: true });
    const second = repository.enqueue({ jid: 'jid-1', body: 'segunda', isProactive: true });

    const pending = repository.findPending(new Date().toISOString());

    expect(pending.map((m) => m.id)).toEqual([first, second]);
  });

  /**
   * Achado de review (FEAT-007): `countProactiveCommittedSince` existe para
   * um chamador (nudges) decidir "ainda cabe no teto?" ANTES do processor
   * confirmar a entrega — precisa contar pending/sending/delivered, nunca só
   * delivered (senão subestima o consumo do dia).
   */
  describe('countProactiveCommittedSince (achado de review, FEAT-007)', () => {
    it('conta pending, sending e delivered — nunca failed', () => {
      const { repository } = buildRepository();
      const nowIso = new Date().toISOString();

      repository.enqueue({ jid: 'jid-1', body: 'pending', isProactive: true });
      const sendingId = repository.enqueue({ jid: 'jid-1', body: 'sending', isProactive: true });
      repository.claimForSending(sendingId);
      const deliveredId = repository.enqueue({ jid: 'jid-1', body: 'delivered', isProactive: true });
      repository.markDelivered(deliveredId, new Date());
      const failedId = repository.enqueue({ jid: 'jid-1', body: 'failed', isProactive: true });
      repository.markFailed(failedId);

      expect(repository.countProactiveCommittedSince(nowIso)).toBe(3);
    });

    it('nunca conta mensagem não-proativa', () => {
      const { repository } = buildRepository();
      const nowIso = new Date().toISOString();

      repository.enqueue({ jid: 'jid-1', body: 'resposta a comando', isProactive: false });

      expect(repository.countProactiveCommittedSince(nowIso)).toBe(0);
    });

    /**
     * Regressão: `created_at` é preenchido por `DEFAULT (datetime('now'))`
     * do SQLite (`YYYY-MM-DD HH:MM:SS`, sem "T"/"Z"), mas `sinceIso` chega em
     * formato ISO (`YYYY-MM-DDTHH:MM:SS.sssZ`) — uma comparação de string
     * `>=` crua entre os dois formatos falha silenciosamente (o espaço do
     * primeiro formato ordena antes do "T" do segundo), fazendo o método
     * subestimar o teto mesmo com a mensagem gravada há poucos segundos.
     */
    it('conta mensagem enfileirada agora comparando contra sinceIso do início do dia (formatos de data diferentes)', () => {
      const { repository } = buildRepository();

      repository.enqueue({ jid: 'jid-1', body: 'briefing de hoje', isProactive: true, isAnchorRitual: true });

      const startOfTodayIso = zonedTimeToUtc(startOfZonedDay(new Date())).toISOString();

      expect(repository.countProactiveCommittedSince(startOfTodayIso)).toBe(1);
    });
  });
});
