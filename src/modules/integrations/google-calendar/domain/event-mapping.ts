/**
 * Recorte mínimo do evento devolvido pela API do Google que o domínio
 * precisa — nunca o tipo bruto do `googleapis` aqui (função pura, sem
 * dependência de I/O nem do SDK, TESTING.md §1). `start`/`end` seguem o
 * formato do Calendar: `dateTime` para evento com horário, `date` (só
 * `YYYY-MM-DD`) para evento de dia inteiro.
 */
export interface GoogleCalendarEvent {
  readonly gcalId: string;
  readonly title: string;
  readonly start: { readonly dateTime?: string; readonly date?: string };
  readonly end: { readonly dateTime?: string; readonly date?: string };
  readonly location?: string;
}

/**
 * `create` quando o evento tem horário e ainda não existe `event` interno
 * com esse `gcalId`; `skip` nos outros dois casos (spec item 3: já
 * sincronizado, ou evento de dia inteiro sem horário — nenhum dos dois gera
 * cadeia). A razão do skip é só para log/depuração, nunca exposta ao usuário.
 */
export type EventSyncDecision =
  | { readonly action: 'create'; readonly startAt: Date; readonly endAt: Date | undefined }
  | { readonly action: 'skip'; readonly reason: 'already_synced' | 'all_day' };

export function mapGoogleEventToSync(
  event: GoogleCalendarEvent,
  hasInternalEvent: (gcalId: string) => boolean,
): EventSyncDecision {
  if (!event.start.dateTime) {
    return { action: 'skip', reason: 'all_day' };
  }

  if (hasInternalEvent(event.gcalId)) {
    return { action: 'skip', reason: 'already_synced' };
  }

  return {
    action: 'create',
    startAt: new Date(event.start.dateTime),
    endAt: event.end.dateTime ? new Date(event.end.dateTime) : undefined,
  };
}
