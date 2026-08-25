const MIN_DELAY_MS = 10_000;
const MAX_DELAY_MS = 45_000;

/**
 * Delay aleatório de 10–45s antes de mensagem proativa — política
 * anti-banimento (ADR-005): rajada de mensagens no instante exato do
 * gatilho é o padrão que sistemas de detecção da Meta associam a bot.
 */
export function randomSendDelayMs(random: () => number = Math.random): number {
  return Math.floor(MIN_DELAY_MS + random() * (MAX_DELAY_MS - MIN_DELAY_MS));
}
