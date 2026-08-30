import type { Database } from 'better-sqlite3';
import type { Logger } from 'pino';
import type { ModuleManifest } from '../../core/kernel/types.js';
import type { LlmProvider } from '../../core/llm/index.js';
import type { JobRepository } from '../../core/scheduler/index.js';
import type { OutboxRepository } from '../../core/outbox/index.js';
import type { AudioRecoveryData, IncomingAudio, MediaFetcher, MessageRepository } from '../../core/channel/index.js';
import type { SttRouter } from '../../core/stt/index.js';
import type { SettingsStore } from '../../core/settings/index.js';
import type { EventService, ItemService } from '../tasks/public/index.js';
import {
  CHAINS_DESLOCAMENTO_MIN_DEFAULT_DEFAULT,
  CHAINS_DESLOCAMENTO_MIN_DEFAULT_SETTING,
  type ChainService,
} from '../chains/public/index.js';
import type { AudioLimits } from './domain/index.js';
import { TriageService } from './triage-service.js';
import { CaptureService, type RemoteCalendarPort } from './capture-service.js';
import { buildCaptureDispatcher } from './capture-dispatcher.js';
import { AudioCaptureService } from './audio-capture-service.js';
import { buildReminderJobHandler } from './reminder-job.js';

export interface CaptureModuleDeps {
  readonly llmProvider: LlmProvider;
  readonly sttRouter: SttRouter;
  readonly mediaFetcher: MediaFetcher;
  readonly itemService: ItemService;
  readonly eventService: EventService;
  readonly chainService: ChainService;
  readonly jobRepository: JobRepository;
  readonly outboxRepository: OutboxRepository;
  readonly messageRepository: MessageRepository;
  readonly settings: SettingsStore;
  readonly ownerJid: string;
  readonly logger: Logger;
  /** Conexão compartilhada com `tasks`/`jobs` (mesmo `db`, ARCHITECTURE.md §2) — usada só para a transação item+job(s) da captura (ADR-018). */
  readonly db: Database;
  /** Ausente quando o Google nunca foi autorizado (env sem credenciais) — captura degrada graciosamente sem evento remoto (ADR-019). */
  readonly googleCalendarService?: RemoteCalendarPort;
  /** Injetável para teste — data/hora do prompt da triagem, seleção de tom e disparo de reminder (TESTING.md §7). */
  readonly now?: () => Date;
}

const TRIAGE_INTENT = 'triagem';

/**
 * Limiar de idade da varredura de recuperação no boot (ADR-018): mensagem
 * `pending` mais nova que isso ainda pode estar em processamento normal (o
 * mesmo processo, sem crash) — só depois desse limiar ela é candidata a
 * reprocessamento. 60s é generoso frente ao timeout de 15s da triagem
 * (RF-01): mesmo um retry de rede dentro do provider não faria a mensagem
 * cruzar essa idade sem ter marcado `processed`/`failed`.
 */
export const PENDING_RECOVERY_THRESHOLD_MS_SETTING = 'capture.pendingRecoveryThresholdMs';
const PENDING_RECOVERY_THRESHOLD_MS_DEFAULT = 60_000;

/**
 * Teto de mensagens reprocessadas por boot: uma fila pending muito grande
 * (dias de máquina desligada no perfil local, ADR-013) não pode transformar
 * a subida do processo numa rajada de chamadas de LLM e de envios — o que
 * sobra fica para o boot seguinte e é logado.
 */
export const PENDING_RECOVERY_MAX_PER_BOOT_SETTING = 'capture.pendingRecoveryMaxPerBoot';
const PENDING_RECOVERY_MAX_PER_BOOT_DEFAULT = 50;

/**
 * Limite de duração/tamanho de áudio (spec item 5, FEAT-003): acima disso
 * nenhuma chamada de STT é feita — nem custo nem latência de provider
 * externo para um áudio que provavelmente vai estourar timeout de qualquer
 * forma. 10 min/20 MB é generoso para qualquer mensagem de voz real do
 * WhatsApp (o limite prático do próprio app é bem menor) e cobre o caso de
 * uso do produto sem exigir configuração manual no dia a dia.
 */
export const AUDIO_MAX_DURATION_SECONDS_SETTING = 'capture.audioMaxDurationSeconds';
const AUDIO_MAX_DURATION_SECONDS_DEFAULT = 600;

export const AUDIO_MAX_FILE_SIZE_BYTES_SETTING = 'capture.audioMaxFileSizeBytes';
const AUDIO_MAX_FILE_SIZE_BYTES_DEFAULT = 20 * 1024 * 1024;

/**
 * `capture` não tem migração própria — grava exclusivamente via o
 * contrato público de `tasks` e via `core/scheduler`/`core/outbox`
 * (ARCHITECTURE.md §2). O dispatcher fica disponível à parte (não é
 * tool/command/job do manifesto) porque o webhook o aciona via
 * `onUnmatchedText`/`onAudioMessage`, pontos de extensão que não existem no
 * `ModuleManifest` — ver Decisões tomadas da FEAT-002.
 */
export function buildCaptureModule(deps: CaptureModuleDeps): {
  manifest: ModuleManifest;
  dispatch: (text: string, jid: string, messageId: number) => Promise<void>;
  dispatchAudio: (audio: IncomingAudio, messageKey: unknown, jid: string, messageId: number) => Promise<void>;
  recoverAudio: (recoveryData: AudioRecoveryData, jid: string, messageId: number) => Promise<void>;
} {
  const triageService = new TriageService({
    provider: deps.llmProvider,
    logger: deps.logger,
    ...(deps.now ? { now: deps.now } : {}),
    onUsage: (usage, jid) =>
      deps.messageRepository.recordLlmUsage({
        jid,
        intent: TRIAGE_INTENT,
        tokensIn: usage.tokensIn,
        tokensOut: usage.tokensOut,
        cacheReadTokens: usage.cacheReadTokens,
      }),
  });

  const captureService = new CaptureService({
    itemService: deps.itemService,
    eventService: deps.eventService,
    chainService: deps.chainService,
    jobRepository: deps.jobRepository,
    db: deps.db,
    logger: deps.logger,
    ...(deps.googleCalendarService ? { googleCalendarService: deps.googleCalendarService } : {}),
    getDeslocamentoMinDefault: () =>
      Number(deps.settings.get<number>(CHAINS_DESLOCAMENTO_MIN_DEFAULT_SETTING) ?? CHAINS_DESLOCAMENTO_MIN_DEFAULT_DEFAULT),
  });

  const dispatch = buildCaptureDispatcher({
    triageService,
    captureService,
    outboxRepository: deps.outboxRepository,
    logger: deps.logger,
    ...(deps.now ? { now: deps.now } : {}),
  });

  const getAudioLimits = (): AudioLimits => ({
    maxDurationSeconds: Number(
      deps.settings.get<number>(AUDIO_MAX_DURATION_SECONDS_SETTING) ?? AUDIO_MAX_DURATION_SECONDS_DEFAULT,
    ),
    maxFileSizeBytes: Number(
      deps.settings.get<number>(AUDIO_MAX_FILE_SIZE_BYTES_SETTING) ?? AUDIO_MAX_FILE_SIZE_BYTES_DEFAULT,
    ),
  });

  const audioCaptureService = new AudioCaptureService({
    mediaFetcher: deps.mediaFetcher,
    sttRouter: deps.sttRouter,
    messageRepository: deps.messageRepository,
    outboxRepository: deps.outboxRepository,
    logger: deps.logger,
    getAudioLimits,
    dispatchText: dispatch,
    ...(deps.now ? { now: deps.now } : {}),
  });

  const manifest: ModuleManifest = {
    name: 'capture',
    jobs: {
      reminder: buildReminderJobHandler({
        outboxRepository: deps.outboxRepository,
        ownerJid: deps.ownerJid,
        ...(deps.now ? { now: deps.now } : {}),
      }),
    },
    settingsDefaults: {
      [PENDING_RECOVERY_THRESHOLD_MS_SETTING]: PENDING_RECOVERY_THRESHOLD_MS_DEFAULT,
      [PENDING_RECOVERY_MAX_PER_BOOT_SETTING]: PENDING_RECOVERY_MAX_PER_BOOT_DEFAULT,
      [AUDIO_MAX_DURATION_SECONDS_SETTING]: AUDIO_MAX_DURATION_SECONDS_DEFAULT,
      [AUDIO_MAX_FILE_SIZE_BYTES_SETTING]: AUDIO_MAX_FILE_SIZE_BYTES_DEFAULT,
    },
  };

  return {
    manifest,
    dispatch,
    dispatchAudio: (audio, messageKey, jid, messageId) => audioCaptureService.processAudio(audio, messageKey, jid, messageId),
    recoverAudio: (recoveryData, jid, messageId) => audioCaptureService.recoverAudio(recoveryData, jid, messageId),
  };
}
