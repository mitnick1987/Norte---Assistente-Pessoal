import { describe, expect, it } from 'vitest';
import { Writable } from 'node:stream';
import { createLogger } from '../../src/core/logger.js';

function captureLogger(nodeEnv: string) {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });

  const logger = createLogger(nodeEnv, stream);
  return { logger, output: () => chunks.join('') };
}

describe('createLogger', () => {
  it('redige o segredo do webhook quando ele chega via query string em req.url (serializer de request)', () => {
    const { logger, output } = captureLogger('production');

    logger.info(
      { req: { method: 'POST', url: '/webhook/evolution?secret=nao-pode-vazar-em-log', id: 1 } },
      'requisição recebida',
    );

    const logged = output();
    expect(logged).not.toContain('nao-pode-vazar-em-log');
    expect(logged).toContain('/webhook/evolution');
  });

  it('preserva o path e mantém method/id quando a URL não tem query string', () => {
    const { logger, output } = captureLogger('production');

    logger.info({ req: { method: 'GET', url: '/health', id: 2 } }, 'requisição recebida');

    const logged = output();
    expect(logged).toContain('/health');
    expect(logged).toContain('"method":"GET"');
  });

  it('continua redigindo os secrets de header conhecidos', () => {
    const { logger, output } = captureLogger('production');

    logger.info({ webhookSecret: 'segredo-de-config-nao-pode-vazar' }, 'algo aconteceu');

    expect(output()).not.toContain('segredo-de-config-nao-pode-vazar');
  });

  it('redige o header Authorization (Bearer da Groq/OpenAI) mesmo se um dia aparecer em log', () => {
    const { logger, output } = captureLogger('production');

    logger.warn(
      { headers: { authorization: 'Bearer chave-groq-nao-pode-vazar' } },
      'falha ao chamar provedor de STT',
    );

    expect(output()).not.toContain('chave-groq-nao-pode-vazar');
  });

  it('redige Authorization em maiúscula (variação de nome de header comum em erro de client HTTP)', () => {
    const { logger, output } = captureLogger('production');

    logger.warn(
      { headers: { Authorization: 'Bearer chave-openai-nao-pode-vazar' } },
      'falha ao chamar provedor de STT',
    );

    expect(output()).not.toContain('chave-openai-nao-pode-vazar');
  });
});
