/**
 * O redact de `paths` do pino (core/logger.ts) só enxerga chaves de objeto
 * conhecidas — não alcança uma credencial embutida dentro de uma string
 * livre, como a mensagem de erro de um transporte SMTP/Resend que ecoa a
 * URL de conexão completa (`smtps://user:senha@host`) ou o corpo de erro do
 * provedor. Sanitiza qualquer trecho `usuario:senha@` de URL embutida na
 * mensagem antes dela chegar ao log (achado de review FEAT-008).
 */
const CREDENTIALS_IN_URL_PATTERN = /\/\/[^/\s:@]+:[^/\s:@]+@/g;

export function sanitizeErrorMessage(message: string): string {
  return message.replace(CREDENTIALS_IN_URL_PATTERN, '//[redacted]@');
}
