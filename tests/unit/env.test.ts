import { describe, expect, it } from 'vitest';
import { loadEnv, InvalidEnvError } from '../../src/core/env.js';

function validEnv(): NodeJS.ProcessEnv {
  return {
    DB_PATH: './data/norte.db',
    EVOLUTION_API_URL: 'http://localhost:8080',
    EVOLUTION_API_KEY: 'key',
    EVOLUTION_INSTANCE: 'norte',
    EVOLUTION_WEBHOOK_SECRET: 'a'.repeat(32),
    OWNER_WHATSAPP_JID: '5511999999999@s.whatsapp.net',
  };
}

describe('loadEnv', () => {
  it('carrega com sucesso quando todas as variáveis obrigatórias estão presentes', () => {
    const env = loadEnv(validEnv());
    expect(env.OWNER_WHATSAPP_JID).toBe('5511999999999@s.whatsapp.net');
    expect(env.TZ).toBe('America/Sao_Paulo');
    expect(env.DAILY_PROACTIVE_CAP).toBe(6);
  });

  it('rejeita quando falta uma variável obrigatória', () => {
    const { OWNER_WHATSAPP_JID: _omit, ...rest } = validEnv();
    expect(() => loadEnv(rest)).toThrow(InvalidEnvError);
  });

  it('rejeita segredo de webhook curto demais', () => {
    expect(() => loadEnv({ ...validEnv(), EVOLUTION_WEBHOOK_SECRET: 'curto' })).toThrow(InvalidEnvError);
  });

  it('nunca deixa o processo subir com env inválido — a mensagem de erro não vaza valor de secret', () => {
    try {
      loadEnv({ ...validEnv(), EVOLUTION_API_URL: 'não-é-url' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidEnvError);
      expect((err as Error).message).not.toContain('key');
    }
  });
});
