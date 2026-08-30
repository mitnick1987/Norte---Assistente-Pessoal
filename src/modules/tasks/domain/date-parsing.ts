import { addZonedDays, toZonedParts, zonedTimeToUtc, type ZonedDateParts } from '../../../core/scheduler/domain/timezone.js';

/**
 * Parsing leve de data relativa em PT-BR para o comando "adia" (RF-07) e
 * para a extração de due_at na captura. Cobre só o vocabulário que o
 * executor determinístico precisa reconhecer sem LLM — não é um parser de
 * linguagem natural geral; ambiguidade fora daqui cai em `undefined` e quem
 * chama decide (captura joga pra inbox, "adia" pede o dia de novo).
 */

const WEEKDAYS = [
  'domingo',
  'segunda',
  'terca',
  'quarta',
  'quinta',
  'sexta',
  'sabado',
] as const;

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

function withTime(parts: ZonedDateParts, hour: number, minute: number): ZonedDateParts {
  return { ...parts, hour, minute, second: 0 };
}

/** Extrai "14h", "14h30", "às 14:30" do texto; undefined se não achar horário explícito. */
function extractTime(text: string): { hour: number; minute: number } | undefined {
  const match = /(\d{1,2})[h:](\d{2})?/.exec(text);
  if (!match) return undefined;

  const hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  if (hour > 23 || minute > 59) return undefined;

  return { hour, minute };
}

/**
 * Horário padrão quando o texto não especifica hora: 9h. Escolha arbitrária
 * mas necessária — due_at sempre carrega hora (coluna datetime), e um
 * lembrete sem hora não tem quando disparar (RF-04 trata compromisso sem
 * hora como caso à parte, mas o parsing aqui não decide isso, só entrega
 * a melhor data possível).
 */
const DEFAULT_HOUR = 9;
const DEFAULT_MINUTE = 0;

function nextWeekday(reference: ZonedDateParts, targetWeekday: number, forceNextWeek: boolean): ZonedDateParts {
  const referenceUtc = zonedTimeToUtc(reference);
  const referenceWeekday = new Date(referenceUtc).getUTCDay();

  let diff = (targetWeekday - referenceWeekday + 7) % 7;
  if (diff === 0 && forceNextWeek) diff = 7;

  return addZonedDays(reference, diff);
}

export interface ParsedRelativeDate {
  readonly dueAt: Date;
  /** Diz ao chamador se o horário veio explícito no texto ou foi o default — "adia" usa isso para decidir se preserva a hora original do item. */
  readonly hasExplicitTime: boolean;
}

/**
 * `now` é sempre injetado (nunca `new Date()` aqui dentro) — domínio puro,
 * testável sem depender do relógio real (TESTING.md §7).
 */
export function parseRelativeDatePtBr(text: string, now: Date): ParsedRelativeDate | undefined {
  const normalized = normalize(text);
  const time = extractTime(normalized);
  const nowParts = toZonedParts(now);

  if (/\bhoje\b/.test(normalized)) {
    const parts = withTime(nowParts, time?.hour ?? DEFAULT_HOUR, time?.minute ?? DEFAULT_MINUTE);
    return { dueAt: zonedTimeToUtc(parts), hasExplicitTime: Boolean(time) };
  }

  if (/\bamanha\b/.test(normalized)) {
    const tomorrow = addZonedDays(nowParts, 1);
    const parts = withTime(tomorrow, time?.hour ?? DEFAULT_HOUR, time?.minute ?? DEFAULT_MINUTE);
    return { dueAt: zonedTimeToUtc(parts), hasExplicitTime: Boolean(time) };
  }

  const weekdayIndex = WEEKDAYS.findIndex((day) => normalized.includes(day));
  if (weekdayIndex !== -1) {
    const forceNextWeek = /que vem|proxima|proximo/.test(normalized);
    const target = nextWeekday(nowParts, weekdayIndex, forceNextWeek);
    const parts = withTime(target, time?.hour ?? DEFAULT_HOUR, time?.minute ?? DEFAULT_MINUTE);
    return { dueAt: zonedTimeToUtc(parts), hasExplicitTime: Boolean(time) };
  }

  return undefined;
}
