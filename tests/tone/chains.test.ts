import { describe, expect, it } from 'vitest';
import {
  buildManhaMessage,
  buildPreparoMessage,
  buildVesperaMessage,
} from '../../src/modules/chains/domain/index.js';
import { assertToneIsSafe } from './forbidden-patterns.js';

/**
 * Suite de TOM (RF-04, RF-14, TESTING.md §4.1) para as três etapas da
 * cadeia de lembrete: nenhuma pode soar como cobrança — a cadeia avisa,
 * nunca verifica se o compromisso foi cumprido (isso é `nudges`, feature
 * futura). O alerta de saída é o requisito central do RF-04: tempo
 * restante, nunca só horário absoluto.
 */
describe('suite de tom — véspera e manhã da cadeia', () => {
  it('véspera e manhã passam no filtro de tom em todas as variações', () => {
    for (let seed = 0; seed < 10; seed++) {
      assertToneIsSafe(buildVesperaMessage('dentista', seed));
      assertToneIsSafe(buildManhaMessage('dentista', seed));
    }
  });

  it('véspera e manhã são sempre 1 linha, sem pergunta', () => {
    for (let seed = 0; seed < 10; seed++) {
      expect(buildVesperaMessage('dentista', seed).split('\n')).toHaveLength(1);
      expect(buildManhaMessage('dentista', seed).split('\n')).toHaveLength(1);
      expect(buildVesperaMessage('dentista', seed)).not.toMatch(/\?/);
      expect(buildManhaMessage('dentista', seed)).not.toMatch(/\?/);
    }
  });

  it('nenhuma variação soa como cobrança de confirmação ("foi?", "confirma", "vai mesmo?")', () => {
    for (let seed = 0; seed < 10; seed++) {
      expect(buildVesperaMessage('dentista', seed).toLowerCase()).not.toMatch(/confirma|foi\?|vai mesmo/);
      expect(buildManhaMessage('dentista', seed).toLowerCase()).not.toMatch(/confirma|foi\?|vai mesmo/);
    }
  });
});

describe('suite de tom — alerta de "hora de sair" (requisito central do RF-04)', () => {
  it('sempre formulado como tempo restante, nunca só o horário absoluto do compromisso', () => {
    for (let seed = 0; seed < 10; seed++) {
      const message = buildPreparoMessage('dentista', 40, seed);
      assertToneIsSafe(message);
      expect(message).toMatch(/\d+\s*min/);
      expect(message).not.toMatch(/\d{1,2}[:h]\d{2}(?!in)/); // sem horário tipo "14:00"/"14h00" — "min" não é falso positivo aqui
    }
  });

  it('nunca soa como cobrança — é aviso neutro, não checagem de cumprimento', () => {
    for (let seed = 0; seed < 10; seed++) {
      const message = buildPreparoMessage('dentista', 15, seed).toLowerCase();
      expect(message).not.toMatch(/confirma|voc[eê] vai|n[aã]o esque[cç]a|lembra que/);
    }
  });

  it('é sempre 1 linha, sem pergunta', () => {
    for (let seed = 0; seed < 10; seed++) {
      const message = buildPreparoMessage('dentista', 15, seed);
      expect(message.split('\n')).toHaveLength(1);
      expect(message).not.toMatch(/\?/);
    }
  });
});
