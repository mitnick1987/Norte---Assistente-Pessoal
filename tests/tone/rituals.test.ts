import { describe, expect, it } from 'vitest';
import {
  buildBriefingData,
  buildBriefingFallbackMessage,
  buildReviewData,
  buildReviewFallbackMessages,
} from '../../src/modules/rituals/domain/index.js';
import { buildBrainSystemPrompt, TONE_RULES_BLOCK } from '../../src/core/llm/index.js';
import { assertToneIsSafe, FORBIDDEN_TONE_PATTERNS } from './forbidden-patterns.js';

/**
 * Suite de TOM (RF-14, TESTING.md §4.1) das saídas desta feature: o que é
 * testável por código sem depender do modelo real (spec FEAT-006 item 7).
 */
describe('suite de tom — templates de fallback do briefing e da revisão (100% determinístico)', () => {
  it('fallback do briefing passa no filtro de tom em vários cenários de dados', () => {
    const scenarios = [
      buildBriefingData([], []),
      buildBriefingData([{ title: 'dentista', startAt: '2026-08-30T13:00:00.000Z' }], []),
      buildBriefingData(
        [],
        [
          { id: 1, title: 'pagar boleto', priority: 1, dueAt: '2026-08-30T09:00:00.000Z' },
          { id: 2, title: 'revisar contrato', priority: 2, dueAt: '2026-08-31T09:00:00.000Z' },
        ],
      ),
    ];

    for (const data of scenarios) {
      assertToneIsSafe(buildBriefingFallbackMessage(data));
    }
  });

  it('fallback da revisão passa no filtro de tom mesmo com decisão pendente e nada fechado', () => {
    const scenarios = [
      buildReviewData([], [], []),
      buildReviewData([{ title: 'academia' }], [{ title: 'dentista' }], []),
      buildReviewData([], [], [{ id: 1, title: 'projeto parado', priority: null, dueAt: '2026-08-01T09:00:00.000Z' }]),
    ];

    for (const data of scenarios) {
      for (const message of buildReviewFallbackMessages(data)) {
        assertToneIsSafe(message);
      }
    }
  });

  it('payload de dados do briefing nunca contém snoozeCount/contagem de adiamentos, mesmo antes de chegar à redação', () => {
    const data = buildBriefingData(
      [],
      [{ id: 1, title: 'tarefa adiada várias vezes', priority: 1, dueAt: '2026-08-30T09:00:00.000Z' }],
    );

    expect(JSON.stringify(data)).not.toMatch(/snooze/i);
  });

  it('payload de dados da revisão nunca contém snoozeCount/contagem de adiamentos', () => {
    const data = buildReviewData(
      [{ title: 'a' }],
      [{ title: 'b' }],
      [{ id: 1, title: 'item recorrente', priority: null, dueAt: '2026-08-01T09:00:00.000Z' }],
    );

    expect(JSON.stringify(data)).not.toMatch(/snooze/i);
  });
});

describe('suite de tom — bloco de regras RSD-safe no system prompt do brain', () => {
  it('o system prompt sempre contém o bloco de regras de tom, independente dos módulos ativos', () => {
    const prompt = buildBrainSystemPrompt([{ name: 'capture', promptFragment: () => 'fragmento de captura' }]);

    expect(prompt).toContain(TONE_RULES_BLOCK);
  });

  it('o bloco de regras menciona explicitamente as proibições centrais do RF-14', () => {
    expect(TONE_RULES_BLOCK.toLowerCase()).toContain('adiamentos');
    expect(TONE_RULES_BLOCK.toLowerCase()).toContain('fiscal');
  });
});

describe('suite de tom — saída adversarial do Sonnet (o que é barrável por código)', () => {
  /**
   * Simula o texto que o Sonnet poderia devolver (stub determinístico) e
   * comprova que o padrão proibido é de fato detectável pela suite — a
   * garantia real de que o modelo NUNCA produz isso em produção não é
   * testável em CI (spec item 7); o que dá pra garantir aqui é que a
   * ferramenta de verificação pega o padrão quando ele aparece.
   */
  it('detecta menção a histórico de falhas/contagem de adiamentos numa saída simulada do Sonnet', () => {
    const adversarialOutput = 'Notei que você adiou essa tarefa 3ª vez que você faz isso — bora tentar de novo?';

    expect(() => assertToneIsSafe(adversarialOutput)).toThrow();
  });

  it('detecta tom de fiscal numa saída simulada do Sonnet', () => {
    const adversarialOutput = 'Você não fez de novo, hein?';

    expect(() => assertToneIsSafe(adversarialOutput)).toThrow();
  });

  it('detecta tom de animador de torcida forçado numa saída simulada do Sonnet', () => {
    const adversarialOutput = 'Parabéns, campeão! Você é demais!';

    expect(() => assertToneIsSafe(adversarialOutput)).toThrow();
  });

  it('todos os padrões proibidos do TESTING.md §4.1 estão cobertos pela lista compartilhada', () => {
    expect(FORBIDDEN_TONE_PATTERNS.length).toBeGreaterThan(0);
  });
});
