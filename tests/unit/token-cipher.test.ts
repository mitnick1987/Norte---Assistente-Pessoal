import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  InvalidEncryptionKeyError,
  TokenCipher,
  TokenDecryptionError,
} from '../../src/modules/integrations/google-calendar/token-cipher.js';

function randomKey(): string {
  return randomBytes(32).toString('base64');
}

describe('TokenCipher', () => {
  it('decifra de volta exatamente o texto original (round-trip)', () => {
    const cipher = new TokenCipher(randomKey());

    const encrypted = cipher.encrypt('refresh-token-secreto-do-google');

    expect(cipher.decrypt(encrypted)).toBe('refresh-token-secreto-do-google');
  });

  it('nunca reutiliza o IV entre duas cifragens do mesmo texto', () => {
    const cipher = new TokenCipher(randomKey());

    const first = cipher.encrypt('mesmo-valor');
    const second = cipher.encrypt('mesmo-valor');

    const [firstIv] = first.split(':');
    const [secondIv] = second.split(':');
    expect(firstIv).not.toBe(secondIv);
    expect(first).not.toBe(second);
  });

  it('rejeita decifrar com a chave errada — nunca devolve texto corrompido em silêncio', () => {
    const encrypted = new TokenCipher(randomKey()).encrypt('access-token');

    expect(() => new TokenCipher(randomKey()).decrypt(encrypted)).toThrow(TokenDecryptionError);
  });

  it('rejeita payload adulterado (auth tag do GCM não bate)', () => {
    const key = randomKey();
    const cipher = new TokenCipher(key);
    const encrypted = cipher.encrypt('access-token');

    const [iv, authTag, ciphertext] = encrypted.split(':');
    const tamperedCiphertext = Buffer.from(ciphertext!, 'base64');
    tamperedCiphertext[0] = (tamperedCiphertext[0]! + 1) % 256;
    const tampered = [iv, authTag, tamperedCiphertext.toString('base64')].join(':');

    expect(() => cipher.decrypt(tampered)).toThrow(TokenDecryptionError);
  });

  it('rejeita payload malformado (sem as três partes esperadas)', () => {
    const cipher = new TokenCipher(randomKey());

    expect(() => cipher.decrypt('payload-invalido')).toThrow(TokenDecryptionError);
  });

  it('rejeita chave com tamanho diferente de 32 bytes', () => {
    expect(() => new TokenCipher(Buffer.from('chave-curta-demais').toString('base64'))).toThrow(
      InvalidEncryptionKeyError,
    );
  });
});
