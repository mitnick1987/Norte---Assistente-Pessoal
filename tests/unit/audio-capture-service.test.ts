import { describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/core/db/migrator.js';
import { coreMigrations } from '../../src/core/db/migrations/index.js';
import { MessageRepository } from '../../src/core/channel/message-repository.js';
import { MediaUnavailableError } from '../../src/core/channel/whatsapp-evolution/evolution-client.js';
import { OutboxRepository } from '../../src/core/outbox/index.js';
import { AudioCaptureService, SttTotalFailureError } from '../../src/modules/capture/audio-capture-service.js';
import { SttRequestError } from '../../src/core/stt/provider.js';
import { createLogger } from '../../src/core/logger.js';
import type { MediaFetcher } from '../../src/core/channel/index.js';
import type { SttRouter } from '../../src/core/stt/index.js';

const JID = '5511999999999@s.whatsapp.net';
const logger = createLogger('test');
const LIMITS = { maxDurationSeconds: 600, maxFileSizeBytes: 20 * 1024 * 1024 };

function buildContext() {
  const db = new Database(':memory:');
  runMigrations(db, coreMigrations);
  const messageRepository = new MessageRepository(db);
  const outboxRepository = new OutboxRepository(db);
  const { messageId } = messageRepository.tryRecordInbound({
    jid: JID,
    waMessageId: 'wa-audio-1',
    body: undefined,
    mediaType: 'audio',
    audioRecoveryData: { messageKey: { id: 'wa-audio-1' }, mimeType: 'audio/ogg' },
  }) as { messageId: number };
  return { db, messageRepository, outboxRepository, messageId };
}

function lastOutboxBody(db: Database.Database): string | undefined {
  const row = db.prepare('SELECT body FROM outbox_messages ORDER BY id DESC LIMIT 1').get() as
    | { body: string }
    | undefined;
  return row?.body;
}

function stubMediaFetcher(behavior: () => Promise<string>): MediaFetcher {
  return { getBase64FromMediaMessage: behavior };
}

function stubSttRouter(behavior: () => ReturnType<SttRouter['transcribe']>): SttRouter {
  return { transcribe: behavior } as unknown as SttRouter;
}

describe('AudioCaptureService.processAudio (fluxo normal, spec FEAT-003 item 3)', () => {
  it('áudio dentro do limite: busca mídia, transcreve, grava transcrição e delega ao funil de texto', async () => {
    const { db, messageRepository, outboxRepository, messageId } = buildContext();
    const mediaFetcher = stubMediaFetcher(async () => 'QUFB');
    const sttRouter = stubSttRouter(async () => ({ kind: 'ok', text: 'lembra de comprar ração amanhã' }));
    const dispatchText = vi.fn(async () => undefined);

    const service = new AudioCaptureService({
      mediaFetcher,
      sttRouter,
      messageRepository,
      outboxRepository,
      logger,
      getAudioLimits: () => LIMITS,
      dispatchText,
    });

    await service.processAudio({ mimeType: 'audio/ogg', durationSeconds: 5, fileLengthBytes: 1000 }, { id: 'x' }, JID, messageId);

    expect(dispatchText).toHaveBeenCalledWith('lembra de comprar ração amanhã', JID, messageId);
    const row = db.prepare('SELECT transcricao FROM messages WHERE id = ?').get(messageId) as { transcricao: string };
    expect(row.transcricao).toBe('lembra de comprar ração amanhã');
  });

  it('áudio acima do limite: nenhuma chamada a mediaFetcher nem a STT, resposta educada no outbox', async () => {
    const { db, messageRepository, outboxRepository, messageId } = buildContext();
    const mediaFetcher = { getBase64FromMediaMessage: vi.fn(async () => 'QUFB') };
    const sttRouter = { transcribe: vi.fn(async () => ({ kind: 'ok' as const, text: 'x' })) };
    const dispatchText = vi.fn(async () => undefined);

    const service = new AudioCaptureService({
      mediaFetcher,
      sttRouter: sttRouter as unknown as SttRouter,
      messageRepository,
      outboxRepository,
      logger,
      getAudioLimits: () => LIMITS,
      dispatchText,
      now: () => new Date(0),
    });

    await service.processAudio({ mimeType: 'audio/ogg', durationSeconds: 601, fileLengthBytes: 1000 }, { id: 'x' }, JID, messageId);

    expect(mediaFetcher.getBase64FromMediaMessage).not.toHaveBeenCalled();
    expect(sttRouter.transcribe).not.toHaveBeenCalled();
    expect(dispatchText).not.toHaveBeenCalled();
    expect(lastOutboxBody(db)).toBeDefined();
  });

  it('falha total de STT: pede texto no outbox e lança SttTotalFailureError (webhook marca failed, spec item 3)', async () => {
    const { db, messageRepository, outboxRepository, messageId } = buildContext();
    const mediaFetcher = stubMediaFetcher(async () => 'QUFB');
    const sttRouter = stubSttRouter(async () => ({ kind: 'error' }));
    const dispatchText = vi.fn(async () => undefined);

    const service = new AudioCaptureService({
      mediaFetcher,
      sttRouter,
      messageRepository,
      outboxRepository,
      logger,
      getAudioLimits: () => LIMITS,
      dispatchText,
      now: () => new Date(0),
    });

    await expect(
      service.processAudio({ mimeType: 'audio/ogg', durationSeconds: 5, fileLengthBytes: 1000 }, { id: 'x' }, JID, messageId),
    ).rejects.toBeInstanceOf(SttTotalFailureError);

    expect(dispatchText).not.toHaveBeenCalled();
    const body = lastOutboxBody(db);
    expect(body).toBeDefined();
    expect(body!.toLowerCase()).toContain('texto');
  });

  it('mídia real acima do teto de bytes: nenhuma chamada a STT mesmo com metadado ausente/subdimensionado (defesa contra metadado não confiável)', async () => {
    const { db, messageRepository, outboxRepository, messageId } = buildContext();
    const bigBase64 = Buffer.alloc(21 * 1024 * 1024).toString('base64');
    const mediaFetcher = { getBase64FromMediaMessage: vi.fn(async () => bigBase64) };
    const sttRouter = { transcribe: vi.fn(async () => ({ kind: 'ok' as const, text: 'x' })) };
    const dispatchText = vi.fn(async () => undefined);

    const service = new AudioCaptureService({
      mediaFetcher,
      sttRouter: sttRouter as unknown as SttRouter,
      messageRepository,
      outboxRepository,
      logger,
      getAudioLimits: () => LIMITS,
      dispatchText,
      now: () => new Date(0),
    });

    // metadado do webhook ausente — só o tamanho real buscado é confiável.
    await service.processAudio({ mimeType: 'audio/ogg', durationSeconds: undefined, fileLengthBytes: undefined }, { id: 'x' }, JID, messageId);

    expect(mediaFetcher.getBase64FromMediaMessage).toHaveBeenCalled();
    expect(sttRouter.transcribe).not.toHaveBeenCalled();
    expect(dispatchText).not.toHaveBeenCalled();
    expect(lastOutboxBody(db)).toBeDefined();
  });

  it('erro de busca de mídia (MediaUnavailableError) propaga no fluxo normal', async () => {
    const { messageRepository, outboxRepository, messageId } = buildContext();
    const mediaFetcher = stubMediaFetcher(async () => {
      throw new MediaUnavailableError();
    });
    const sttRouter = stubSttRouter(async () => ({ kind: 'ok', text: 'x' }));
    const dispatchText = vi.fn(async () => undefined);

    const service = new AudioCaptureService({
      mediaFetcher,
      sttRouter,
      messageRepository,
      outboxRepository,
      logger,
      getAudioLimits: () => LIMITS,
      dispatchText,
    });

    await expect(
      service.processAudio({ mimeType: 'audio/ogg', durationSeconds: 5, fileLengthBytes: 1000 }, { id: 'x' }, JID, messageId),
    ).rejects.toBeInstanceOf(MediaUnavailableError);
  });

  it('erro inesperado do sttRouter propaga (nunca engolido em silêncio)', async () => {
    const { messageRepository, outboxRepository, messageId } = buildContext();
    const mediaFetcher = stubMediaFetcher(async () => 'QUFB');
    const sttRouter = stubSttRouter(async () => {
      throw new SttRequestError('bug inesperado no router');
    });

    const service = new AudioCaptureService({
      mediaFetcher,
      sttRouter,
      messageRepository,
      outboxRepository,
      logger,
      getAudioLimits: () => LIMITS,
      dispatchText: async () => undefined,
    });

    await expect(
      service.processAudio({ mimeType: 'audio/ogg', durationSeconds: 5, fileLengthBytes: 1000 }, { id: 'x' }, JID, messageId),
    ).rejects.toThrow(SttRequestError);
  });
});

describe('AudioCaptureService.recoverAudio (varredura de recuperação, spec FEAT-003 item 4)', () => {
  it('mídia disponível: transcreve com sucesso e delega ao funil de texto', async () => {
    const { db, messageRepository, outboxRepository, messageId } = buildContext();
    const mediaFetcher = stubMediaFetcher(async () => 'QUFB');
    const sttRouter = stubSttRouter(async () => ({ kind: 'ok', text: 'marca dentista sexta' }));
    const dispatchText = vi.fn(async () => undefined);

    const service = new AudioCaptureService({
      mediaFetcher,
      sttRouter,
      messageRepository,
      outboxRepository,
      logger,
      getAudioLimits: () => LIMITS,
      dispatchText,
    });

    await service.recoverAudio({ messageKey: { id: 'x' }, mimeType: 'audio/ogg' }, JID, messageId);

    expect(dispatchText).toHaveBeenCalledWith('marca dentista sexta', JID, messageId);
    const row = db.prepare('SELECT transcricao FROM messages WHERE id = ?').get(messageId) as { transcricao: string };
    expect(row.transcricao).toBe('marca dentista sexta');
  });

  it('mídia expirada (MediaUnavailableError): pede texto no outbox e relança o erro para o core marcar processed', async () => {
    const { db, messageRepository, outboxRepository, messageId } = buildContext();
    const mediaFetcher = stubMediaFetcher(async () => {
      throw new MediaUnavailableError();
    });
    const dispatchText = vi.fn(async () => undefined);

    const service = new AudioCaptureService({
      mediaFetcher,
      sttRouter: stubSttRouter(async () => ({ kind: 'ok', text: 'não deveria chegar aqui' })),
      messageRepository,
      outboxRepository,
      logger,
      getAudioLimits: () => LIMITS,
      dispatchText,
      now: () => new Date(0),
    });

    await expect(service.recoverAudio({ messageKey: { id: 'x' }, mimeType: 'audio/ogg' }, JID, messageId)).rejects.toBeInstanceOf(
      MediaUnavailableError,
    );

    expect(dispatchText).not.toHaveBeenCalled();
    const body = lastOutboxBody(db);
    expect(body).toBeDefined();
    expect(body!.toLowerCase()).toContain('texto');
  });

  it('mídia expirada: usa Date real quando `now` não é injetado (comportamento default de produção)', async () => {
    const { messageRepository, outboxRepository, messageId } = buildContext();
    const mediaFetcher = stubMediaFetcher(async () => {
      throw new MediaUnavailableError();
    });

    const service = new AudioCaptureService({
      mediaFetcher,
      sttRouter: stubSttRouter(async () => ({ kind: 'ok', text: 'x' })),
      messageRepository,
      outboxRepository,
      logger,
      getAudioLimits: () => LIMITS,
      dispatchText: async () => undefined,
    });

    await expect(
      service.recoverAudio({ messageKey: { id: 'x' }, mimeType: 'audio/ogg' }, JID, messageId),
    ).rejects.toBeInstanceOf(MediaUnavailableError);
  });

  it('falha total de STT na recuperação (mídia obtida, STT falhou): pede texto e propaga SttTotalFailureError (regra geral do item 3, marca failed)', async () => {
    const { db, messageRepository, outboxRepository, messageId } = buildContext();
    const mediaFetcher = stubMediaFetcher(async () => 'QUFB');
    const sttRouter = stubSttRouter(async () => ({ kind: 'error' }));

    const service = new AudioCaptureService({
      mediaFetcher,
      sttRouter,
      messageRepository,
      outboxRepository,
      logger,
      getAudioLimits: () => LIMITS,
      dispatchText: async () => undefined,
      now: () => new Date(0),
    });

    await expect(
      service.recoverAudio({ messageKey: { id: 'x' }, mimeType: 'audio/ogg' }, JID, messageId),
    ).rejects.toBeInstanceOf(SttTotalFailureError);

    expect(lastOutboxBody(db)).toBeDefined();
  });

  it('não aplica o teto de bytes reais na recuperação (mesma regra do item 4: não recusa algo que já estava em voo)', async () => {
    const { messageRepository, outboxRepository, messageId } = buildContext();
    const bigBase64 = Buffer.alloc(21 * 1024 * 1024).toString('base64');
    const mediaFetcher = stubMediaFetcher(async () => bigBase64);
    const sttRouter = stubSttRouter(async () => ({ kind: 'ok', text: 'áudio grande recuperado após restart' }));
    const dispatchText = vi.fn(async () => undefined);

    const service = new AudioCaptureService({
      mediaFetcher,
      sttRouter,
      messageRepository,
      outboxRepository,
      logger,
      getAudioLimits: () => LIMITS,
      dispatchText,
    });

    await service.recoverAudio({ messageKey: { id: 'x' }, mimeType: 'audio/ogg' }, JID, messageId);

    expect(dispatchText).toHaveBeenCalledWith('áudio grande recuperado após restart', JID, messageId);
  });

  it('não aplica checagem de limite (spec item 4: mensagem já passou dessa fase antes do crash, ou o limite mudou desde então)', async () => {
    const { messageRepository, outboxRepository, messageId } = buildContext();
    const mediaFetcher = stubMediaFetcher(async () => 'QUFB');
    const sttRouter = stubSttRouter(async () => ({ kind: 'ok', text: 'áudio que excederia o limite atual' }));
    const dispatchText = vi.fn(async () => undefined);
    // limite atual bem abaixo de qualquer áudio real — se `recoverAudio`
    // checasse limite, isto teria que gerar a mensagem de "áudio muito
    // longo" e nunca chamar dispatchText.
    const getAudioLimits = vi.fn(() => ({ maxDurationSeconds: 0, maxFileSizeBytes: 0 }));

    const service = new AudioCaptureService({
      mediaFetcher,
      sttRouter,
      messageRepository,
      outboxRepository,
      logger,
      getAudioLimits,
      dispatchText,
    });

    await service.recoverAudio({ messageKey: { id: 'x' }, mimeType: 'audio/ogg' }, JID, messageId);

    expect(getAudioLimits).not.toHaveBeenCalled();
    expect(dispatchText).toHaveBeenCalledWith('áudio que excederia o limite atual', JID, messageId);
  });
});
