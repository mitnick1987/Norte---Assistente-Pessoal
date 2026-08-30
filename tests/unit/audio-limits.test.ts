import { describe, expect, it } from 'vitest';
import { base64ByteLength, exceedsAudioLimits, exceedsRealSizeLimit } from '../../src/modules/capture/domain/audio-limits.js';

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

describe('base64ByteLength', () => {
  it('calcula o tamanho real em bytes a partir do comprimento da string base64', () => {
    const buffer = Buffer.alloc(1024, 'a');
    expect(base64ByteLength(buffer.toString('base64'))).toBe(1024);
  });

  it('desconta o padding "=" do cálculo', () => {
    const buffer = Buffer.alloc(10, 'a');
    const base64 = buffer.toString('base64');
    expect(base64ByteLength(base64)).toBe(10);
  });
});

describe('exceedsRealSizeLimit (teto sobre o tamanho real da mídia buscada, não sobre metadado do remetente)', () => {
  it('mídia real dentro do limite não excede, mesmo sem nenhum metadado de tamanho', () => {
    const base64 = Buffer.alloc(1024).toString('base64');
    expect(exceedsRealSizeLimit(base64, LIMITS)).toBe(false);
  });

  it('mídia real acima do limite excede, ainda que o metadado do webhook diga que está dentro (ou esteja ausente)', () => {
    const base64 = Buffer.alloc(21 * 1024 * 1024).toString('base64');
    expect(exceedsRealSizeLimit(base64, LIMITS)).toBe(true);
  });
});
