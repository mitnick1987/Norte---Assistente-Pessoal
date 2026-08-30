import { describe, expect, it } from 'vitest';
import { pickSttFailureMessage, pickAudioTooLongMessage } from '../../src/modules/capture/domain/index.js';
import { assertToneIsSafe } from './forbidden-patterns.js';

/**
 * Suite de TOM (RF-14, TESTING.md §4.1) para o caminho de áudio (FEAT-003):
 * falha total de STT e limite de duração/tamanho excedido. Nenhuma das duas
 * pode soar como defeito do usuário nem expor causa técnica.
 */
describe('suite de tom — falha total de STT', () => {
  it('nenhuma variação menciona falha técnica ou culpa o usuário', () => {
    for (let seed = 0; seed < 10; seed++) {
      const message = pickSttFailureMessage(seed);
      assertToneIsSafe(message);
      expect(message.toLowerCase()).not.toMatch(/falhou|falha (t[ée]cnica|no sistema)|erro/);
    }
  });

  it('pede o conteúdo em texto, em 1 linha', () => {
    for (let seed = 0; seed < 10; seed++) {
      const message = pickSttFailureMessage(seed);
      expect(message.split('\n')).toHaveLength(1);
      expect(message.toLowerCase()).toContain('texto');
    }
  });
});

describe('suite de tom — limite de duração/tamanho de áudio excedido', () => {
  it('é educado, sem tom de repreensão', () => {
    for (let seed = 0; seed < 10; seed++) {
      const message = pickAudioTooLongMessage(seed);
      assertToneIsSafe(message);
      expect(message.toLowerCase()).not.toMatch(/muito grande|exagerad|deveria/);
    }
  });

  it('informa o limite em 1 linha, sem tentar transcrever', () => {
    for (let seed = 0; seed < 10; seed++) {
      const message = pickAudioTooLongMessage(seed);
      expect(message.split('\n')).toHaveLength(1);
    }
  });
});
