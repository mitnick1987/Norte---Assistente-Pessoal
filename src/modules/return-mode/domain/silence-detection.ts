const SILENCE_THRESHOLD_MS = 48 * 60 * 60 * 1000;

/**
 * Modo retorno ativo (RF-10): última mensagem de entrada mais antiga que
 * 48h. `lastInboundAt` ausente (nunca chegou nenhuma mensagem antes desta)
 * nunca ativa o modo — não há "silêncio" antes do primeiro contato.
 */
export function isReturnModeActive(lastInboundAt: Date | undefined, now: Date): boolean {
  if (!lastInboundAt) return false;
  return now.getTime() - lastInboundAt.getTime() >= SILENCE_THRESHOLD_MS;
}

export const RETURN_MODE_SILENCE_THRESHOLD_MS = SILENCE_THRESHOLD_MS;
