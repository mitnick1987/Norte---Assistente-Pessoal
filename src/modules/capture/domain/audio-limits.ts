export interface AudioLimits {
  readonly maxDurationSeconds: number;
  readonly maxFileSizeBytes: number;
}

export interface AudioToCheck {
  readonly durationSeconds: number | undefined;
  readonly fileLengthBytes: number | undefined;
}

/**
 * Áudio acima do limite não é enviado a nenhum provedor de STT (spec item
 * 5) — checagem em JS puro, antes de qualquer I/O, para o teste de unit
 * conseguir asserir "o client de STT não foi chamado" sem stubar rede.
 * Metadado ausente (nem todo cliente WhatsApp envia `seconds`/`fileLength`)
 * não bloqueia: melhor deixar passar e o provider eventualmente rejeitar do
 * que recusar um áudio válido por falta de metadado.
 */
export function exceedsAudioLimits(audio: AudioToCheck, limits: AudioLimits): boolean {
  if (audio.durationSeconds !== undefined && audio.durationSeconds > limits.maxDurationSeconds) return true;
  if (audio.fileLengthBytes !== undefined && audio.fileLengthBytes > limits.maxFileSizeBytes) return true;
  return false;
}
