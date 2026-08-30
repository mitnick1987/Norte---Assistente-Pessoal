import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH_BYTES = 32;
const IV_LENGTH_BYTES = 12;
const AUTH_TAG_LENGTH_BYTES = 16;

export class InvalidEncryptionKeyError extends Error {
  constructor() {
    super(`TOKEN_ENCRYPTION_KEY precisa ter ${KEY_LENGTH_BYTES} bytes em base64 (AES-256-GCM)`);
    this.name = 'InvalidEncryptionKeyError';
  }
}

/** Ciphertext adulterado ou cifrado com outra chave — GCM rejeita antes de devolver qualquer byte do texto original. */
export class TokenDecryptionError extends Error {
  constructor(cause?: unknown) {
    super('falha ao decifrar token: chave incorreta ou dado adulterado', cause !== undefined ? { cause } : undefined);
    this.name = 'TokenDecryptionError';
  }
}

function parseKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== KEY_LENGTH_BYTES) throw new InvalidEncryptionKeyError();
  return key;
}

/**
 * AES-256-GCM com IV aleatório por operação (SECURITY.md §4, spec item 2):
 * formato armazenado é `iv:authTag:ciphertext`, tudo em base64 — o IV nunca é
 * reaproveitado entre cifragens, nem quando o mesmo texto é cifrado duas
 * vezes (não há como comparar ciphertexts para inferir igualdade de texto).
 */
export class TokenCipher {
  private readonly key: Buffer;

  constructor(encryptionKeyBase64: string) {
    this.key = parseKey(encryptionKeyBase64);
  }

  encrypt(plainText: string): string {
    const iv = randomBytes(IV_LENGTH_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return [iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join(':');
  }

  decrypt(payload: string): string {
    const parts = payload.split(':');
    if (parts.length !== 3) throw new TokenDecryptionError();

    const [ivPart, authTagPart, ciphertextPart] = parts;
    const iv = Buffer.from(ivPart!, 'base64');
    const authTag = Buffer.from(authTagPart!, 'base64');
    const ciphertext = Buffer.from(ciphertextPart!, 'base64');

    if (iv.length !== IV_LENGTH_BYTES || authTag.length !== AUTH_TAG_LENGTH_BYTES) {
      throw new TokenDecryptionError();
    }

    try {
      const decipher = createDecipheriv(ALGORITHM, this.key, iv);
      decipher.setAuthTag(authTag);
      const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      return plaintext.toString('utf8');
    } catch (err) {
      throw new TokenDecryptionError(err);
    }
  }
}
