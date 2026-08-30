import { describe, expect, it, vi } from 'vitest';
import { extFromMime } from '../../src/core/stt/mime.js';

describe('extFromMime', () => {
  it.each([
    ['audio/ogg', 'ogg'],
    ['audio/ogg; codecs=opus', 'ogg'],
    ['audio/opus', 'ogg'],
    ['audio/mpeg', 'mp3'],
    ['audio/mp3', 'mp3'],
    ['audio/mp4', 'm4a'],
    ['audio/m4a', 'm4a'],
    ['audio/wav', 'wav'],
    ['audio/webm', 'webm'],
    ['audio/amr', 'amr'],
  ])('mapeia %s para extensão %s', (mimeType, expected) => {
    expect(extFromMime(mimeType)).toBe(expected);
  });

  it('mimeType desconhecido usa extensão default (ogg)', () => {
    expect(extFromMime('audio/x-nunca-visto')).toBe('ogg');
  });

  it('mimeType desconhecido loga aviso com o mimeType recebido', () => {
    const warn = vi.fn();
    const logger = { warn } as unknown as Parameters<typeof extFromMime>[1];

    extFromMime('audio/x-nunca-visto', logger);

    expect(warn).toHaveBeenCalledWith({ mimeType: 'audio/x-nunca-visto' }, expect.any(String));
  });

  it('mimeType conhecido não loga nada', () => {
    const warn = vi.fn();
    const logger = { warn } as unknown as Parameters<typeof extFromMime>[1];

    extFromMime('audio/ogg', logger);

    expect(warn).not.toHaveBeenCalled();
  });
});
