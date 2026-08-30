import type { Logger } from 'pino';

const MIME_TO_EXT: Record<string, string> = {
  'audio/ogg': 'ogg',
  'audio/opus': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/m4a': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/webm': 'webm',
  'audio/amr': 'amr',
};

const DEFAULT_EXT = 'ogg';

/**
 * Groq e OpenAI inferem o formato do áudio pela extensão do filename da
 * parte multipart, não pelo Content-Type — um Blob anexado ao FormData sem
 * filename vira "blob" sem extensão e os dois endpoints respondem 400.
 * `codecs` (ex.: "audio/ogg; codecs=opus") não faz parte do mapeamento,
 * por isso o corte antes do `;`.
 */
export function extFromMime(mimeType: string, logger?: Logger): string {
  const normalized = mimeType.split(';')[0]!.trim().toLowerCase();
  const ext = MIME_TO_EXT[normalized];
  if (ext) return ext;

  logger?.warn({ mimeType }, 'mimeType de áudio desconhecido, usando extensão default para o upload de STT');
  return DEFAULT_EXT;
}
