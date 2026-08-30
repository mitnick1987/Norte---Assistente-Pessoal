import { describe, expect, it } from 'vitest';
import { buildCaptureTestContext } from '../factories/capture-test-context.js';

// terça-feira 2026-08-25 10:00 America/Sao_Paulo (13:00 UTC) — mesma referência do parser de datas.
const FIXED_NOW = new Date('2026-08-25T13:00:00.000Z');

function buildService() {
  // `now` fixo também para o ChainService (não só para parseRelativeDatePtBr) —
  // expandChain descarta etapa cujo horário já passou, e a data real do
  // sistema roda anos à frente de 2026-08-25 (TESTING.md §7).
  const { db, captureService: service, jobRepository } = buildCaptureTestContext({ now: () => FIXED_NOW });
  return { db, service, jobRepository };
}

describe('CaptureService (ponte captura -> task-store, RF-01/RF-03)', () => {
  it('grava item sem dueExpression sem criar nenhum job', () => {
    const { service, jobRepository } = buildService();

    const [captured] = service.captureItems([{ type: 'nota', title: 'ideia solta' }], 1, FIXED_NOW);

    expect(captured?.title).toBe('ideia solta');
    expect(captured?.dueExpressionUnresolved).toBe(false);
    expect(jobRepository.findPending()).toHaveLength(0);
  });

  it('item lembrete com dueExpression reconhecida (ADR-006) resolve via parseRelativeDatePtBr e agenda job "reminder" avulso', () => {
    const { service, jobRepository } = buildService();

    service.captureItems([{ type: 'lembrete', title: 'ligar pro dentista', dueExpression: 'sexta 14h' }], 1, FIXED_NOW);

    const pending = jobRepository.findPending();
    expect(pending).toHaveLength(1);
    // 2026-08-28 é sexta-feira; 14h America/Sao_Paulo = 17h UTC.
    expect(pending[0]).toMatchObject({ type: 'reminder', next_run_at: '2026-08-28T17:00:00.000Z' });
  });

  it('item compromisso com dueExpression reconhecida gera event + cadeia inteira, nunca um job "reminder" avulso (FEAT-004)', () => {
    const { db, service, jobRepository } = buildService();

    service.captureItems([{ type: 'compromisso', title: 'dentista', dueExpression: 'sexta 14h' }], 1, FIXED_NOW);

    const event = db.prepare('SELECT item_id, title, start_at, cadeia_gerada FROM events').get() as {
      item_id: number;
      title: string;
      start_at: string;
      cadeia_gerada: number;
    };
    expect(event).toMatchObject({ title: 'dentista', start_at: '2026-08-28T17:00:00.000Z', cadeia_gerada: 1 });

    // véspera (qui 20h), manhã (sex 8h) e preparo (sex 14h - deslocamento - margem) — todas no futuro a partir de FIXED_NOW.
    const pending = jobRepository.findPending();
    expect(pending).toHaveLength(3);
    expect(pending.every((j) => j.type === 'reminder')).toBe(true);
  });

  it('item com dueExpression não reconhecida vira inbox sem job, e sinaliza dueExpressionUnresolved (nunca data alucinada)', () => {
    const { db, service, jobRepository } = buildService();

    const [captured] = service.captureItems(
      [{ type: 'compromisso', title: 'dentista', dueExpression: 'lá pelas tantas' }],
      1,
      FIXED_NOW,
    );

    expect(captured?.dueExpressionUnresolved).toBe(true);
    const row = db.prepare('SELECT status, due_at FROM items').get() as { status: string; due_at: string | null };
    expect(row.status).toBe('inbox');
    expect(row.due_at).toBeNull();
    expect(jobRepository.findPending()).toHaveLength(0);
    expect(db.prepare('SELECT COUNT(*) as c FROM events').get()).toMatchObject({ c: 0 });
  });

  it('item ambíguo é gravado em inbox', () => {
    const { db, service } = buildService();

    service.captureItems([{ type: 'tarefa', title: 'algo incerto', ambiguous: true }], 1, FIXED_NOW);

    const row = db.prepare('SELECT status FROM items').get() as { status: string };
    expect(row.status).toBe('inbox');
  });

  it('múltiplos itens de uma captura geram múltiplos itens gravados', () => {
    const { db, service } = buildService();

    const captured = service.captureItems(
      [
        { type: 'tarefa', title: 'a' },
        { type: 'ideia', title: 'b' },
      ],
      1,
      FIXED_NOW,
    );

    expect(captured).toHaveLength(2);
    const count = db.prepare('SELECT COUNT(*) as c FROM items').get() as { c: number };
    expect(count.c).toBe(2);
  });

  it('grava o vínculo source_message_id em cada item capturado', () => {
    const { db, service } = buildService();

    service.captureItems([{ type: 'nota', title: 'x' }], 77, FIXED_NOW);

    const row = db.prepare('SELECT source_message_id FROM items').get() as { source_message_id: number };
    expect(row.source_message_id).toBe(77);
  });

  it('reprocessar o mesmo sourceMessageId não duplica item nem cria um segundo job (idempotência, ADR-018)', () => {
    const { db, service, jobRepository } = buildService();

    service.captureItems([{ type: 'lembrete', title: 'ligar pro dentista', dueExpression: 'sexta 14h' }], 5, FIXED_NOW);
    const secondAttempt = service.captureItems(
      [{ type: 'lembrete', title: 'ligar pro dentista', dueExpression: 'sexta 14h' }],
      5,
      FIXED_NOW,
    );

    expect(secondAttempt).toHaveLength(0);
    const count = db.prepare('SELECT COUNT(*) as c FROM items').get() as { c: number };
    expect(count.c).toBe(1);
    expect(jobRepository.findPending()).toHaveLength(1);
  });

  it('reprocessar captura de compromisso não duplica item nem gera uma segunda cadeia (idempotência, ADR-018)', () => {
    const { db, service, jobRepository } = buildService();

    service.captureItems([{ type: 'compromisso', title: 'dentista', dueExpression: 'sexta 14h' }], 6, FIXED_NOW);
    const secondAttempt = service.captureItems(
      [{ type: 'compromisso', title: 'dentista', dueExpression: 'sexta 14h' }],
      6,
      FIXED_NOW,
    );

    expect(secondAttempt).toHaveLength(0);
    expect(db.prepare('SELECT COUNT(*) as c FROM events').get()).toMatchObject({ c: 1 });
    expect(jobRepository.findPending()).toHaveLength(3);
  });

  it('mensagens de origem diferentes continuam gravando itens independentes', () => {
    const { db, service } = buildService();

    service.captureItems([{ type: 'nota', title: 'x' }], 1, FIXED_NOW);
    service.captureItems([{ type: 'nota', title: 'y' }], 2, FIXED_NOW);

    const count = db.prepare('SELECT COUNT(*) as c FROM items').get() as { c: number };
    expect(count.c).toBe(2);
  });

  it('recuperação parcial: crash entre o item 0 e o item 1 de uma captura multi-item completa só o que falta (ADR-018)', () => {
    const { db, service, jobRepository } = buildService();
    const threeItems = [
      { type: 'tarefa' as const, title: 'a' },
      { type: 'ideia' as const, title: 'b' },
      { type: 'lembrete' as const, title: 'c', dueExpression: 'sexta 14h' },
    ];

    // Simula o processo morrendo logo após a primeira transação item+job
    // (item 0) da tentativa original — só esse item chegou a ser gravado,
    // com source_item_index=0. A idempotência antiga (existsBySourceMessageId)
    // veria "já existe item dessa mensagem" e pularia 1 e 2 para sempre.
    db.prepare(
      `INSERT INTO items (type, title, origin, status, source_message_id, source_item_index)
       VALUES ('tarefa', 'a', 'texto', 'ativa', 9, 0)`,
    ).run();

    const recovered = service.captureItems(threeItems, 9, FIXED_NOW);

    expect(recovered).toHaveLength(2);
    expect(recovered.map((i) => i.title)).toEqual(['b', 'c']);

    const count = db.prepare('SELECT COUNT(*) as c FROM items').get() as { c: number };
    expect(count.c).toBe(3);

    const titles = db.prepare('SELECT title FROM items ORDER BY source_item_index').all() as { title: string }[];
    expect(titles.map((r) => r.title)).toEqual(['a', 'b', 'c']);

    // o item 2 (lembrete com dueExpression) precisa ter o job dele criado
    // na recuperação — não é só o item que faltava, é item+job juntos.
    expect(jobRepository.findPending()).toHaveLength(1);
  });

  it('recuperação parcial não duplica nem recria o job do item que já tinha sido gravado com sucesso', () => {
    const { db, service, jobRepository } = buildService();
    const twoItems = [
      { type: 'lembrete' as const, title: 'ligar pro dentista', dueExpression: 'sexta 14h' },
      { type: 'nota' as const, title: 'ideia solta' },
    ];

    service.captureItems(twoItems, 20, FIXED_NOW);
    expect(jobRepository.findPending()).toHaveLength(1);

    // segunda chamada com os mesmos itens (reentrega/reprocessamento completo, não parcial).
    const secondAttempt = service.captureItems(twoItems, 20, FIXED_NOW);

    expect(secondAttempt).toHaveLength(0);
    const count = db.prepare('SELECT COUNT(*) as c FROM items').get() as { c: number };
    expect(count.c).toBe(2);
    expect(jobRepository.findPending()).toHaveLength(1);
  });
});
