import { describe, expect, it } from 'vitest';
import {
  buildMicroStep,
  buildBriefingData,
  buildBriefingFallbackMessage,
  buildReviewData,
  buildReviewFallbackMessages,
  selectReviewDecisionCandidate,
  REVIEW_MAX_MESSAGES,
  type PrioritizableItem,
} from '../../src/modules/rituals/domain/index.js';

function item(overrides: Partial<PrioritizableItem> & { id: number }): PrioritizableItem {
  return { title: `item ${overrides.id}`, priority: null, dueAt: null, ...overrides };
}

describe('buildMicroStep (heurística de código, RF-17 parcial)', () => {
  it('título que começa com verbo de ação vira "Começar por: <título>"', () => {
    expect(buildMicroStep('Ligar para o dentista')).toBe('Começar por: Ligar para o dentista.');
  });

  it('título sem verbo reconhecível cai no genérico, nunca soa como pergunta', () => {
    const step = buildMicroStep('Projeto do cliente X');

    expect(step).not.toMatch(/\?/);
    expect(step.length).toBeGreaterThan(0);
  });

  it('reconhece verbo com acentuação normalizada', () => {
    expect(buildMicroStep('Começar relatório mensal')).toContain('Começar relatório mensal');
  });
});

describe('buildBriefingData (payload sem snoozeCount, spec item 5/7)', () => {
  it('nunca inclui snoozeCount ou qualquer contagem de adiamentos no payload', () => {
    const items = [item({ id: 1, title: 'pagar boleto', dueAt: '2026-09-01T10:00:00.000Z' })];

    const data = buildBriefingData([], items);

    expect(JSON.stringify(data)).not.toMatch(/snooze/i);
  });

  it('seleciona no máximo 3 prioridades e o micropasso da primeira', () => {
    const items = Array.from({ length: 5 }, (_, i) =>
      item({ id: i + 1, title: `tarefa ${i + 1}`, dueAt: `2026-09-0${i + 1}T10:00:00.000Z` }),
    );

    const data = buildBriefingData([], items);

    expect(data.priorities).toHaveLength(3);
    expect(data.priorities[0]!.title).toBe('tarefa 1');
    expect(data.microStep).toBeDefined();
  });

  it('sem nenhuma prioridade, microStep é undefined (nunca inventa um passo do nada)', () => {
    const data = buildBriefingData([], []);

    expect(data.priorities).toHaveLength(0);
    expect(data.microStep).toBeUndefined();
  });

  it('agenda entra tal como recebida, sem alterar/filtrar', () => {
    const agenda = [{ title: 'reunião', startAt: '2026-08-30T13:00:00.000Z' }];

    const data = buildBriefingData(agenda, []);

    expect(data.agenda).toEqual(agenda);
  });
});

describe('buildBriefingFallbackMessage (template 100% determinístico, ADR-006)', () => {
  it('sempre termina com a pergunta acionável fixa', () => {
    const data = buildBriefingData([], [item({ id: 1, title: 'revisar contrato' })]);

    const message = buildBriefingFallbackMessage(data);

    expect(message).toContain('Qual você encara primeiro?');
  });

  it('sem agenda, informa isso de forma honesta em vez de omitir a seção', () => {
    const message = buildBriefingFallbackMessage(buildBriefingData([], []));

    expect(message.toLowerCase()).toContain('sem compromisso');
  });

  it('mesmos dados de entrada produzem a mesma mensagem (determinístico, sem LLM)', () => {
    const data = buildBriefingData(
      [{ title: 'dentista', startAt: '2026-08-30T13:00:00.000Z' }],
      [item({ id: 1, title: 'pagar boleto', dueAt: '2026-08-30T09:00:00.000Z' })],
    );

    expect(buildBriefingFallbackMessage(data)).toBe(buildBriefingFallbackMessage(data));
  });
});

describe('selectReviewDecisionCandidate e buildReviewData (spec item 6)', () => {
  it('seleciona no máximo UMA decisão a pedir, mesmo com vários itens elegíveis', () => {
    const eligible = [item({ id: 5 }), item({ id: 2 }), item({ id: 8 })];

    const candidate = selectReviewDecisionCandidate(eligible);

    expect(candidate).toBeDefined();
  });

  it('escolhe o item mais antigo (menor id) como critério determinístico', () => {
    const eligible = [item({ id: 5 }), item({ id: 2 }), item({ id: 8 })];

    const candidate = selectReviewDecisionCandidate(eligible);

    expect(candidate!.id).toBe(2);
  });

  it('sem itens elegíveis, nenhuma decisão é pedida', () => {
    expect(selectReviewDecisionCandidate([])).toBeUndefined();
  });

  it('payload de revisão nunca inclui snoozeCount', () => {
    const data = buildReviewData([{ title: 'tarefa concluída' }], [{ title: 'tarefa adiada' }], [item({ id: 1 })]);

    expect(JSON.stringify(data)).not.toMatch(/snooze/i);
  });
});

describe('buildReviewFallbackMessages (teto de mensagens, spec item 6)', () => {
  it('nunca excede REVIEW_MAX_MESSAGES mensagens', () => {
    const data = buildReviewData(
      [{ title: 'a' }, { title: 'b' }],
      [{ title: 'c' }, { title: 'd' }],
      [item({ id: 1, title: 'decisão pendente' })],
    );

    const messages = buildReviewFallbackMessages(data);

    expect(messages.length).toBeLessThanOrEqual(REVIEW_MAX_MESSAGES);
  });

  it('sem nada fechado hoje, reconhece isso sem tom de cobrança', () => {
    const data = buildReviewData([], [], []);

    const messages = buildReviewFallbackMessages(data);

    expect(messages[0]).not.toMatch(/\d+\s*(ª|a)\s*vez/i);
  });

  it('mensagem de decisão é respondível por número (menu 1/2/3)', () => {
    const data = buildReviewData([], [], [item({ id: 1, title: 'academia' })]);

    const messages = buildReviewFallbackMessages(data);

    expect(messages.join(' ')).toMatch(/1\).*2\).*3\)/s);
  });
});
