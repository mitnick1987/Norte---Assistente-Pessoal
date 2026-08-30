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
    ANTHROPIC_API_KEY: 'test-anthropic-key',
  };
}

describe('loadEnv', () => {
  it('carrega com sucesso quando todas as variáveis obrigatórias estão presentes', () => {
    const env = loadEnv(validEnv());
    expect(env.OWNER_WHATSAPP_JID).toBe('5511999999999@s.whatsapp.net');
    expect(env.TZ).toBe('America/Sao_Paulo');
    expect(env.DAILY_PROACTIVE_CAP).toBe(6);
  });

  it('HOST assume 0.0.0.0 por padrão — bind em loopback deixaria o webhook do Compose inalcançável', () => {
    const env = loadEnv(validEnv());
    expect(env.HOST).toBe('0.0.0.0');
  });

  it('aceita HOST customizado via variável de ambiente', () => {
    const env = loadEnv({ ...validEnv(), HOST: '127.0.0.1' });
    expect(env.HOST).toBe('127.0.0.1');
  });

  it('rejeita quando falta uma variável obrigatória', () => {
    const { OWNER_WHATSAPP_JID: _omit, ...rest } = validEnv();
    expect(() => loadEnv(rest)).toThrow(InvalidEnvError);
  });

  it('rejeita quando falta ANTHROPIC_API_KEY (SECURITY.md §4)', () => {
    const { ANTHROPIC_API_KEY: _omit, ...rest } = validEnv();
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

  it('sobe sem as credenciais do Google Calendar (setup é manual e opcional, spec item 5 da FEAT-005)', () => {
    const env = loadEnv(validEnv());
    expect(env.GOOGLE_CLIENT_ID).toBeUndefined();
    expect(env.TOKEN_ENCRYPTION_KEY).toBeUndefined();
  });

  it('aceita TOKEN_ENCRYPTION_KEY válida (32 bytes em base64, AES-256-GCM)', () => {
    const key = Buffer.alloc(32, 7).toString('base64');
    const env = loadEnv({ ...validEnv(), TOKEN_ENCRYPTION_KEY: key });
    expect(env.TOKEN_ENCRYPTION_KEY).toBe(key);
  });

  it('rejeita TOKEN_ENCRYPTION_KEY com tamanho diferente de 32 bytes (ADR-010, SECURITY.md §4)', () => {
    const shortKey = Buffer.alloc(16, 7).toString('base64');
    expect(() => loadEnv({ ...validEnv(), TOKEN_ENCRYPTION_KEY: shortKey })).toThrow(InvalidEnvError);
  });

  it('rejeita GOOGLE_REDIRECT_URI que não seja uma URL', () => {
    expect(() => loadEnv({ ...validEnv(), GOOGLE_REDIRECT_URI: 'não-é-url' })).toThrow(InvalidEnvError);
  });
});
