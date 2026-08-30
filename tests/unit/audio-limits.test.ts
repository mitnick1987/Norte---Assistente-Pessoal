import { describe, expect, it } from 'vitest';
import { exceedsAudioLimits } from '../../src/modules/capture/domain/audio-limits.js';

const LIMITS = { maxDurationSeconds: 600, maxFileSizeBytes: 20 * 1024 * 1024 };

describe('exceedsAudioLimits (spec FEAT-003, item 5)', () => {
  it('áudio dentro dos dois limites não excede', () => {
    expect(exceedsAudioLimits({ durationSeconds: 60, fileLengthBytes: 1024 }, LIMITS)).toBe(false);
  });

  it('áudio acima do limite de duração excede', () => {
    expect(exceedsAudioLimits({ durationSeconds: 601, fileLengthBytes: 1024 }, LIMITS)).toBe(true);
  });

  it('áudio acima do limite de tamanho excede', () => {
    expect(exceedsAudioLimits({ durationSeconds: 60, fileLengthBytes: 21 * 1024 * 1024 }, LIMITS)).toBe(true);
  });

  it('áudio exatamente no limite não excede (limite é inclusivo)', () => {
    expect(exceedsAudioLimits({ durationSeconds: 600, fileLengthBytes: 20 * 1024 * 1024 }, LIMITS)).toBe(false);
  });

  it('metadado ausente (duração/tamanho undefined) não bloqueia — deixa passar para o provider decidir', () => {
    expect(exceedsAudioLimits({ durationSeconds: undefined, fileLengthBytes: undefined }, LIMITS)).toBe(false);
  });

  it('só duração presente, dentro do limite: não excede mesmo sem tamanho', () => {
    expect(exceedsAudioLimits({ durationSeconds: 60, fileLengthBytes: undefined }, LIMITS)).toBe(false);
  });
});
