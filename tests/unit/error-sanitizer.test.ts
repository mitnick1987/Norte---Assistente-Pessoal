import { describe, expect, it } from 'vitest';
import { sanitizeErrorMessage } from '../../src/infra-ops/domain/error-sanitizer.js';

describe('sanitizeErrorMessage', () => {
  it('redige usuário:senha embutidos numa URL de conexão SMTP', () => {
    const message = 'ECONNREFUSED ao conectar em smtps://dono:senha-secreta@smtp.test:465';
    expect(sanitizeErrorMessage(message)).toBe('ECONNREFUSED ao conectar em smtps://[redacted]@smtp.test:465');
    expect(sanitizeErrorMessage(message)).not.toContain('senha-secreta');
  });

  it('redige mesmo com múltiplas URLs com credencial na mesma mensagem', () => {
    const message = 'falha ao chamar smtps://a:x1@host1 e smtps://b:x2@host2';
    const sanitized = sanitizeErrorMessage(message);
    expect(sanitized).not.toContain('x1');
    expect(sanitized).not.toContain('x2');
  });

  it('mensagem sem URL/credencial passa inalterada', () => {
    const message = 'Resend respondeu 401';
    expect(sanitizeErrorMessage(message)).toBe(message);
  });

  it('URL sem credencial (só host) passa inalterada', () => {
    const message = 'falha ao conectar em https://api.resend.com/emails';
    expect(sanitizeErrorMessage(message)).toBe(message);
  });
});
