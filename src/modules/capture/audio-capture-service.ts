import type { Logger } from 'pino';
import type { AudioRecoveryData, IncomingAudio, MediaFetcher, MessageRepository } from '../../core/channel/index.js';
import { MediaUnavailableError } from '../../core/channel/whatsapp-evolution/index.js';
import type { OutboxRepository } from '../../core/outbox/index.js';
import type { SttRouter } from '../../core/stt/index.js';
import {
  exceedsAudioLimits,
  exceedsRealSizeLimit,
  pickAudioTooLongMessage,
  pickSttFailureMessage,
  type AudioLimits,
} from './domain/index.js';

export interface AudioCaptureServiceDeps {
  readonly mediaFetcher: MediaFetcher;
  readonly sttRouter: SttRouter;
  readonly messageRepository: MessageRepository;
  readonly outboxRepository: OutboxRepository;
  readonly logger: Logger;
  readonly getAudioLimits: () => AudioLimits;
  /** Continuação do funil de texto (mesmo `dispatch` do capture-dispatcher, spec item 3: "nenhum prompt, schema ou serviço novo de triagem"). */
  readonly dispatchText: (text: string, jid: string, messageId: number) => Promise<void>;
  /** Injetável para teste — seleção de variação de tom precisa ser reproduzível (TESTING.md §7). */
  now?: () => Date;
}

/**
 * Falha total de STT (spec item 3): primário e fallback ambos falharam.
 * Erro próprio — não é `SttRequestError` (isso já foi tratado dentro do
 * `SttRouter`) — para o webhook distinguir "preciso marcar `failed` e logar"
 * de qualquer outra exceção não relacionada.
 */
export class SttTotalFailureError extends Error {
  constructor() {
    super('falha total de STT: primário e fallback indisponíveis');
    this.name = 'SttTotalFailureError';
  }
}

/**
 * Orquestra tudo que existe *antes* da triagem para o caminho de áudio
 * (spec, Contexto e objetivo): checagem de limite → busca ativa de mídia →
 * STT com fallback → grava transcrição → entrega ao MESMO funil de texto.
 * Nunca duplica triagem/captura — só produz o texto que o funil já sabe
 * processar.
 *
 * Falha total de STT (spec item 3) sempre enfileira a resposta pedindo
 * texto e relança `SttTotalFailureError` — o webhook marca a mensagem como
 * `failed` com log de erro (nunca fica presa em silêncio). Erro de busca de
 * mídia (`MediaUnavailableError`) segue o mesmo caminho no fluxo normal
 * (propaga como falha real); na recuperação (`recoverAudio`) é o sinal de
 * mídia expirada que o core sabe tratar diferente, marcando `processed`
 * (spec item 4).
 */
export class AudioCaptureService {
  constructor(private readonly deps: AudioCaptureServiceDeps) {}

  async processAudio(audio: IncomingAudio, messageKey: unknown, jid: string, messageId: number): Promise<void> {
    const now = this.deps.now ?? (() => new Date());
    const limits = this.deps.getAudioLimits();

    if (exceedsAudioLimits(audio, limits)) {
      this.deps.logger.warn({ messageId, audio, limits }, 'áudio acima do limite configurado, nenhuma chamada a STT');
      this.deps.outboxRepository.enqueue({
        jid,
        body: pickAudioTooLongMessage(now().getTime()),
        isProactive: false,
      });
      return;
    }

    await this.transcribeAndDispatch(messageKey, audio.mimeType, jid, messageId, { checkRealSizeLimit: true });
  }

  /**
   * Varredura de recuperação (spec item 4): sem checagem de limite de
   * *metadado* — a mensagem já passou dessa fase antes do crash (ou o
   * limite mudou desde então, o que não é motivo para recusar algo que já
   * estava em voo). O teto de bytes reais (defesa contra metadado
   * forjado/ausente, abaixo) segue a mesma regra: não bloqueia aqui pelo
   * mesmo motivo — recusar na recuperação um áudio que na captura original
   * já teria passado pelo teto não protege nada, só nega um item legítimo.
   *
   * Mídia expirada (`MediaUnavailableError`) é tratada aqui, não só
   * repassada: a spec exige a MESMA mensagem de falha total pedindo texto
   * (item 4), e só quem sabe compor essa mensagem é este módulo — o erro é
   * relançado depois de enfileirar a resposta para o `pending-recovery.ts`
   * do core decidir `processed` (nunca `failed`) a partir do tipo do erro.
   * `SttTotalFailureError` (mídia obtida, mas STT falhou totalmente) segue a
   * regra geral do item 3 e propaga sem tratamento especial aqui.
   */
  async recoverAudio(recoveryData: AudioRecoveryData, jid: string, messageId: number): Promise<void> {
    try {
      await this.transcribeAndDispatch(recoveryData.messageKey, recoveryData.mimeType, jid, messageId, {
        checkRealSizeLimit: false,
      });
    } catch (err) {
      if (err instanceof MediaUnavailableError) {
        const now = this.deps.now ?? (() => new Date());
        this.deps.outboxRepository.enqueue({ jid, body: pickSttFailureMessage(now().getTime()), isProactive: false });
      }
      throw err;
    }
  }

  private async transcribeAndDispatch(
    messageKey: unknown,
    mimeType: string,
    jid: string,
    messageId: number,
    options: { readonly checkRealSizeLimit: boolean },
  ): Promise<void> {
    const now = this.deps.now ?? (() => new Date());

    const audioBase64 = await this.deps.mediaFetcher.getBase64FromMediaMessage(messageKey);

    // Metadado do webhook (`exceedsAudioLimits`) é opcional e controlado
    // pelo remetente — este teto usa o tamanho real da mídia já buscada,
    // único valor que não dá pra forjar/omitir para contornar o limite de
    // negócio (não se aplica na recuperação, ver comentário de `recoverAudio`).
    if (options.checkRealSizeLimit && exceedsRealSizeLimit(audioBase64, this.deps.getAudioLimits())) {
      this.deps.logger.warn({ messageId }, 'áudio acima do limite real de bytes buscado da Evolution, nenhuma chamada a STT');
      this.deps.outboxRepository.enqueue({ jid, body: pickAudioTooLongMessage(now().getTime()), isProactive: false });
      return;
    }

    const sttResult = await this.deps.sttRouter.transcribe({ audioBase64, mimeType });

    if (sttResult.kind === 'error') {
      this.deps.logger.error({ messageId }, 'falha total de STT (primário e fallback), pedindo texto');
      this.deps.outboxRepository.enqueue({ jid, body: pickSttFailureMessage(now().getTime()), isProactive: false });
      throw new SttTotalFailureError();
    }

    // Gravada antes de seguir para a triagem (spec item 2) — fica
    // registrada mesmo que a triagem/captura falhem depois.
    this.deps.messageRepository.recordTranscription(messageId, sttResult.text);

    await this.deps.dispatchText(sttResult.text, jid, messageId);
  }
}
