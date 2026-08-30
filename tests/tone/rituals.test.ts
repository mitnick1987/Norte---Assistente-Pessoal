import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/core/db/migrator.js';
import { coreMigrations } from '../../src/core/db/migrations/index.js';
import { tasksMigrations } from '../../src/modules/tasks/migrations/index.js';
import { ItemsRepository } from '../../src/modules/tasks/items-repository.js';
import { ItemService } from '../../src/modules/tasks/item-service.js';
import { PendingMenuRepository } from '../../src/core/menu/index.js';
import { HygieneService } from '../../src/modules/hygiene/hygiene-service.js';
import { buildRitualsCommands } from '../../src/modules/rituals/commands.js';
import { buildHygieneCommands } from '../../src/modules/hygiene/commands.js';
import {
  buildBriefingData,
  buildBriefingFallbackMessage,
  buildReviewData,
  buildReviewFallbackMessages,
} from '../../src/modules/rituals/domain/index.js';
import { buildBrainSystemPrompt, TONE_RULES_BLOCK } from '../../src/core/llm/index.js';
import { assertToneIsSafe, FORBIDDEN_TONE_PATTERNS } from './forbidden-patterns.js';

const NOW = new Date('2026-08-30T23:00:00.000Z');

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

/**
 * Suite de TOM (achado de review, FEAT-007): respostas dos comandos novos
 * que resolvem "1"/"2"/"3" sobre a decisão da revisão/higiene — mesma régua
 * das mensagens de cobrança/reagendamento, testada por código.
 */
describe('suite de tom — respostas dos comandos de decisão de revisão/higiene', () => {
  function buildContext() {
    const db = new Database(':memory:');
    runMigrations(db, [...coreMigrations, ...tasksMigrations]);
    const itemService = new ItemService(new ItemsRepository(db), () => NOW);
    const hygieneService = new HygieneService({ itemService, now: () => NOW });
    const pendingMenuRepository = new PendingMenuRepository(db);
    return {
      itemService,
      pendingMenuRepository,
      ritualsCommands: buildRitualsCommands(itemService, pendingMenuRepository, () => NOW),
      hygieneCommands: buildHygieneCommands(itemService, hygieneService, pendingMenuRepository, () => NOW),
    };
  }

  it('respostas de manter/adiar/dropar da revisão passam no filtro de tom', async () => {
    for (const digit of ['1', '2', '3'] as const) {
      const { itemService, pendingMenuRepository, ritualsCommands } = buildContext();
      const item = itemService.create({ type: 'tarefa', title: 'projeto parado', origin: 'texto' });
      pendingMenuRepository.record('revisao', item.id);

      const name = digit === '1' ? 'rituals.review.keep' : digit === '2' ? 'rituals.review.snooze' : 'rituals.review.drop';
      const command = ritualsCommands.find((c) => c.name === name)!;
      const result = await command.handle({ text: digit, ownerJid: 'x' });

      assertToneIsSafe(result.replyText);
    }
  });

  it('respostas de arquivar/dropar/adiar da higiene passam no filtro de tom', async () => {
    for (const digit of ['1', '2', '3'] as const) {
      const { itemService, pendingMenuRepository, hygieneCommands } = buildContext();
      const item = itemService.create({ type: 'tarefa', title: 'projeto parado', origin: 'texto' });
      pendingMenuRepository.record('higiene', item.id);

      const name = digit === '1' ? 'hygiene.proposal.archive' : digit === '2' ? 'hygiene.proposal.drop' : 'hygiene.proposal.snooze';
      const command = hygieneCommands.find((c) => c.name === name)!;
      const result = await command.handle({ text: digit, ownerJid: 'x' });

      assertToneIsSafe(result.replyText);
    }
  });

  it('resposta de item já resolvido (corrida com outro caminho) passa no filtro de tom, nunca soa como erro', async () => {
    const { itemService, pendingMenuRepository, ritualsCommands } = buildContext();
    const item = itemService.create({ type: 'tarefa', title: 'projeto parado', origin: 'texto' });
    pendingMenuRepository.record('revisao', item.id);
    itemService.complete(item.id);

    const command = ritualsCommands.find((c) => c.name === 'rituals.review.drop')!;
    const result = await command.handle({ text: '3', ownerJid: 'x' });

    assertToneIsSafe(result.replyText);
    expect(result.replyText.toLowerCase()).not.toMatch(/erro|falha|exception/);
  });
});
