const TIME_ZONE = 'America/Sao_Paulo';

/**
 * Não há DST no Brasil desde 2019, mas o offset de São Paulo (-03:00) não é
 * um número que a gente deveria hard-codar: Intl.DateTimeFormat com o
 * timeZone explícito é a única forma de ficar correto sem depender do TZ
 * do processo/servidor (regra CODE_STYLE §2).
 */
function zonedParts(date: Date): Record<string, string> {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = formatter.formatToParts(date);
  return Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
}

export interface ZonedDateParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function toZonedParts(date: Date): ZonedDateParts {
  const p = zonedParts(date);
  return {
    year: Number(p['year']),
    month: Number(p['month']),
    day: Number(p['day']),
    hour: Number(p['hour']),
    minute: Number(p['minute']),
    second: Number(p['second']),
  };
}

/**
 * Constrói um instante UTC a partir de campos "de parede" em
 * America/Sao_Paulo. Resolve o offset por tentativa: como o fuso é fixo
 * (-03:00, sem DST), uma iteração já converge — o loop existe só para não
 * hard-codar o offset e sobreviver a uma eventual mudança de política.
 */
export function zonedTimeToUtc(parts: ZonedDateParts): Date {
  const naiveUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  let guess = new Date(naiveUtc);

  for (let i = 0; i < 3; i++) {
    const observed = toZonedParts(guess);
    const observedUtc = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
      observed.second,
    );
    const diffMs = naiveUtc - observedUtc;
    if (diffMs === 0) break;
    guess = new Date(guess.getTime() + diffMs);
  }

  return guess;
}

export function startOfZonedDay(date: Date): ZonedDateParts {
  const p = toZonedParts(date);
  return { ...p, hour: 0, minute: 0, second: 0 };
}

export function addZonedDays(parts: ZonedDateParts, days: number): ZonedDateParts {
  const utcMidday = Date.UTC(parts.year, parts.month - 1, parts.day, 12, 0, 0);
  const shifted = new Date(utcMidday + days * 24 * 60 * 60 * 1000);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

export function addZonedMonths(parts: ZonedDateParts, months: number): ZonedDateParts {
  const totalMonths = (parts.month - 1) + months;
  const year = parts.year + Math.floor(totalMonths / 12);
  const month = ((totalMonths % 12) + 12) % 12;
  const daysInTargetMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return {
    year,
    month: month + 1,
    day: Math.min(parts.day, daysInTargetMonth),
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

export const SAO_PAULO_TIME_ZONE = TIME_ZONE;
