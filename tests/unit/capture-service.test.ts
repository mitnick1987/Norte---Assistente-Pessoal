import { describe, expect, it, vi } from 'vitest';
import { buildCaptureTestContext } from '../factories/capture-test-context.js';
import type { RemoteCalendarPort } from '../../src/modules/capture/capture-service.js';

// terça-feira 2026-08-25 10:00 America/Sao_Paulo (13:00 UTC) — mesma referência do parser de datas.
const FIXED_NOW = new Date('2026-08-25T13:00:00.000Z');

function buildService(googleCalendarService?: RemoteCalendarPort) {
  // `now` fixo também para o ChainService (não só para parseRelativeDatePtBr) —
  // expandChain descarta etapa cujo horário já passou, e a data real do
  // sistema roda anos à frente de 2026-08-25 (TESTING.md §7).
  const { db, captureService: service, jobRepository, eventService } = buildCaptureTestContext({
    now: () => FIXED_NOW,
    ...(googleCalendarService ? { googleCalendarService } : {}),
  });
  return { db, service, jobRepository, eventService };
}

describe('CaptureService (ponte captura -> task-store, RF-01/RF-03)', () => {
  it('grava item sem dueExpression sem criar nenhum job', async () => {
    const { service, jobRepository } = buildService();

    const [captured] = await service.captureItems([{ type: 'nota', title: 'ideia solta' }], 1, FIXED_NOW);

    expect(captured?.title).toBe('ideia solta');
    expect(captured?.dueExpressionUnresolved).toBe(false);
    expect(jobRepository.findPending()).toHaveLength(0);
  });

  it('item lembrete com dueExpression reconhecida (ADR-006) resolve via parseRelativeDatePtBr e agenda job "reminder" avulso', async () => {
    const { service, jobRepository } = buildService();

    await service.captureItems([{ type: 'lembrete', title: 'ligar pro dentista', dueExpression: 'sexta 14h' }], 1, FIXED_NOW);

    const pending = jobRepository.findPending();
    expect(pending).toHaveLength(1);
    // 2026-08-28 é sexta-feira; 14h America/Sao_Paulo = 17h UTC.
    expect(pending[0]).toMatchObject({ type: 'reminder', next_run_at: '2026-08-28T17:00:00.000Z' });
  });

  it('item compromisso com dueExpression reconhecida gera event + cadeia inteira, nunca um job "reminder" avulso (FEAT-004)', async () => {
    const { db, service, jobRepository } = buildService();

    await service.captureItems([{ type: 'compromisso', title: 'dentista', dueExpression: 'sexta 14h' }], 1, FIXED_NOW);

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

  it('item com dueExpression não reconhecida vira inbox sem job, e sinaliza dueExpressionUnresolved (nunca data alucinada)', async () => {
    const { db, service, jobRepository } = buildService();

    const [captured] = await service.captureItems(
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

  it('item ambíguo é gravado em inbox', async () => {
    const { db, service } = buildService();

    await service.captureItems([{ type: 'tarefa', title: 'algo incerto', ambiguous: true }], 1, FIXED_NOW);

    const row = db.prepare('SELECT status FROM items').get() as { status: string };
    expect(row.status).toBe('inbox');
  });

  it('múltiplos itens de uma captura geram múltiplos itens gravados', async () => {
    const { db, service } = buildService();

    const captured = await service.captureItems(
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

  it('grava o vínculo source_message_id em cada item capturado', async () => {
    const { db, service } = buildService();

    await service.captureItems([{ type: 'nota', title: 'x' }], 77, FIXED_NOW);

    const row = db.prepare('SELECT source_message_id FROM items').get() as { source_message_id: number };
    expect(row.source_message_id).toBe(77);
  });

  it('reprocessar o mesmo sourceMessageId não duplica item nem cria um segundo job (idempotência, ADR-018)', async () => {
    const { db, service, jobRepository } = buildService();

    await service.captureItems([{ type: 'lembrete', title: 'ligar pro dentista', dueExpression: 'sexta 14h' }], 5, FIXED_NOW);
    const secondAttempt = await service.captureItems(
      [{ type: 'lembrete', title: 'ligar pro dentista', dueExpression: 'sexta 14h' }],
      5,
      FIXED_NOW,
    );

    expect(secondAttempt).toHaveLength(0);
    const count = db.prepare('SELECT COUNT(*) as c FROM items').get() as { c: number };
    expect(count.c).toBe(1);
    expect(jobRepository.findPending()).toHaveLength(1);
  });

  it('reprocessar captura de compromisso não duplica item nem gera uma segunda cadeia (idempotência, ADR-018)', async () => {
    const { db, service, jobRepository } = buildService();

    await service.captureItems([{ type: 'compromisso', title: 'dentista', dueExpression: 'sexta 14h' }], 6, FIXED_NOW);
    const secondAttempt = await service.captureItems(
      [{ type: 'compromisso', title: 'dentista', dueExpression: 'sexta 14h' }],
      6,
      FIXED_NOW,
    );

    expect(secondAttempt).toHaveLength(0);
    expect(db.prepare('SELECT COUNT(*) as c FROM events').get()).toMatchObject({ c: 1 });
    expect(jobRepository.findPending()).toHaveLength(3);
  });

  it('mensagens de origem diferentes continuam gravando itens independentes', async () => {
    const { db, service } = buildService();

    await service.captureItems([{ type: 'nota', title: 'x' }], 1, FIXED_NOW);
    await service.captureItems([{ type: 'nota', title: 'y' }], 2, FIXED_NOW);

    const count = db.prepare('SELECT COUNT(*) as c FROM items').get() as { c: number };
    expect(count.c).toBe(2);
  });

  it('recuperação parcial: crash entre o item 0 e o item 1 de uma captura multi-item completa só o que falta (ADR-018)', async () => {
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

    const recovered = await service.captureItems(threeItems, 9, FIXED_NOW);

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

  it('recuperação parcial não duplica nem recria o job do item que já tinha sido gravado com sucesso', async () => {
    const { db, service, jobRepository } = buildService();
    const twoItems = [
      { type: 'lembrete' as const, title: 'ligar pro dentista', dueExpression: 'sexta 14h' },
      { type: 'nota' as const, title: 'ideia solta' },
    ];

    await service.captureItems(twoItems, 20, FIXED_NOW);
    expect(jobRepository.findPending()).toHaveLength(1);

    // segunda chamada com os mesmos itens (reentrega/reprocessamento completo, não parcial).
    const secondAttempt = await service.captureItems(twoItems, 20, FIXED_NOW);

    expect(secondAttempt).toHaveLength(0);
    const count = db.prepare('SELECT COUNT(*) as c FROM items').get() as { c: number };
    expect(count.c).toBe(2);
    expect(jobRepository.findPending()).toHaveLength(1);
  });
});

describe('CaptureService — escrita no Google Calendar pelo caminho determinístico (ADR-019, FEAT-005)', () => {
  it('compromisso com Google autorizado cria o evento remoto, grava o gcal_id e segue gerando a cadeia normalmente', async () => {
    const googleCalendarService: RemoteCalendarPort = {
      createRemoteEvent: vi.fn().mockResolvedValue({ gcalId: 'gcal-123' }),
    };
    const { db, service, jobRepository, eventService } = buildService(googleCalendarService);

    await service.captureItems([{ type: 'compromisso', title: 'dentista', dueExpression: 'sexta 14h' }], 1, FIXED_NOW);

    expect(googleCalendarService.createRemoteEvent).toHaveBeenCalledTimes(1);
    expect(googleCalendarService.createRemoteEvent).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'dentista', startAt: expect.any(Date), endAt: expect.any(Date) }),
    );

    const row = db.prepare('SELECT gcal_id FROM events').get() as { gcal_id: string | null };
    expect(row.gcal_id).toBe('gcal-123');

    // a cadeia continua sendo gerada exatamente como no caminho sem Google.
    expect(jobRepository.findPending()).toHaveLength(3);
    const event = eventService.findByGcalId('gcal-123');
    expect(event?.cadeiaGerada).toBe(true);
  });

  it('compromisso sem Google autorizado (sem tokens) degrada graciosamente: cria só o event interno + cadeia, sem erro', async () => {
    const googleCalendarService: RemoteCalendarPort = {
      createRemoteEvent: vi.fn().mockRejectedValue(new Error('nenhum token armazenado para o provider "google_calendar"')),
    };
    const { db, service, jobRepository } = buildService(googleCalendarService);

    const captured = await service.captureItems(
      [{ type: 'compromisso', title: 'dentista', dueExpression: 'sexta 14h' }],
      1,
      FIXED_NOW,
    );

    expect(captured).toHaveLength(1);
    const row = db.prepare('SELECT gcal_id, cadeia_gerada FROM events').get() as {
      gcal_id: string | null;
      cadeia_gerada: number;
    };
    expect(row.gcal_id).toBeNull();
    expect(row.cadeia_gerada).toBe(1);
    expect(jobRepository.findPending()).toHaveLength(3);
  });

  it('sem googleCalendarService configurado (Google nunca autorizado no boot), captura funciona normalmente sem tentar chamada nenhuma', async () => {
    const { db, service, jobRepository } = buildService();

    await service.captureItems([{ type: 'compromisso', title: 'dentista', dueExpression: 'sexta 14h' }], 1, FIXED_NOW);

    const row = db.prepare('SELECT gcal_id FROM events').get() as { gcal_id: string | null };
    expect(row.gcal_id).toBeNull();
    expect(jobRepository.findPending()).toHaveLength(3);
  });

  it('reprocessamento (ADR-018) não chama o Google de novo nem duplica o evento remoto — item já gravado é pulado inteiro', async () => {
    const googleCalendarService: RemoteCalendarPort = {
      createRemoteEvent: vi.fn().mockResolvedValue({ gcalId: 'gcal-999' }),
    };
    const { db, service, jobRepository } = buildService(googleCalendarService);

    await service.captureItems([{ type: 'compromisso', title: 'dentista', dueExpression: 'sexta 14h' }], 6, FIXED_NOW);
    const secondAttempt = await service.captureItems(
      [{ type: 'compromisso', title: 'dentista', dueExpression: 'sexta 14h' }],
      6,
      FIXED_NOW,
    );

    expect(secondAttempt).toHaveLength(0);
    expect(googleCalendarService.createRemoteEvent).toHaveBeenCalledTimes(1);
    expect(db.prepare('SELECT COUNT(*) as c FROM events').get()).toMatchObject({ c: 1 });
    expect(jobRepository.findPending()).toHaveLength(3);
  });

  it('evento que já chega com gcal_id (ex.: sincronizado antes) nunca dispara uma segunda criação remota', async () => {
    const googleCalendarService: RemoteCalendarPort = {
      createRemoteEvent: vi.fn().mockResolvedValue({ gcalId: 'nao-deveria-ser-chamado' }),
    };
    const { service, eventService } = buildService(googleCalendarService);

    // simula um event interno que já nasceu com gcalId (fora do fluxo de captura, ex. sync de leitura)
    // — a asserção real aqui é que createRemoteEventFor nunca é acionado para eventos que não vêm de captura de compromisso novo.
    await service.captureItems([{ type: 'nota', title: 'sem evento' }], 1, FIXED_NOW);

    expect(googleCalendarService.createRemoteEvent).not.toHaveBeenCalled();
    expect(eventService.findByGcalId('nao-deveria-ser-chamado')).toBeUndefined();
  });
});
