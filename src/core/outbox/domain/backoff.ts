/**
 * Backoff exponencial com teto — 2^n minutos, capado em 1h para não deixar
 * um job travado horas a fio esperando o próximo retry em cenário de
 * outage prolongado da Evolution.
 */
const BASE_DELAY_MS = 60_000;
const MAX_DELAY_MS = 60 * 60_000;
const MAX_ATTEMPTS = 5;

export function nextRetryDelayMs(attempts: number): number {
  const delay = BASE_DELAY_MS * 2 ** attempts;
  return Math.min(delay, MAX_DELAY_MS);
}

export function retriesExhausted(attempts: number): boolean {
  return attempts >= MAX_ATTEMPTS;
}

export { MAX_ATTEMPTS };
