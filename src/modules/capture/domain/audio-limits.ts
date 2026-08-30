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

/**
 * Tamanho real em bytes a partir do comprimento da string base64, sem
 * decodificar o buffer inteiro — o metadado do webhook (`exceedsAudioLimits`
 * acima) é controlado pelo remetente e não bloqueia quando ausente; este é o
 * teto que não depende de nenhum valor informado pelo cliente, aplicado
 * sobre a mídia efetivamente buscada na Evolution.
 */
export function base64ByteLength(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return (base64.length * 3) / 4 - padding;
}

export function exceedsRealSizeLimit(base64: string, limits: AudioLimits): boolean {
  return base64ByteLength(base64) > limits.maxFileSizeBytes;
}
