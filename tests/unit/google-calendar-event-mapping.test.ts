import { describe, expect, it } from 'vitest';
import { AuthTokenNotFoundError, mapGoogleEventToSync } from '../../src/modules/integrations/google-calendar/domain/index.js';

describe('AuthTokenNotFoundError', () => {
  it('mensagem orienta a rodar o setup OAuth, sem vazar detalhe interno', () => {
    const err = new AuthTokenNotFoundError('google_calendar');

    expect(err.name).toBe('AuthTokenNotFoundError');
    expect(err.message).toContain('google_calendar');
    expect(err.message).toContain('/setup/google');
  });
});

describe('mapGoogleEventToSync', () => {
  it('decide "create" para evento com horário e ainda sem event interno correspondente', () => {
    const decision = mapGoogleEventToSync(
      {
        gcalId: 'gcal-1',
        title: 'Dentista',
        start: { dateTime: '2026-09-04T16:00:00-03:00' },
        end: { dateTime: '2026-09-04T17:00:00-03:00' },
      },
      () => false,
    );

    expect(decision.action).toBe('create');
    if (decision.action === 'create') {
      expect(decision.startAt.toISOString()).toBe(new Date('2026-09-04T16:00:00-03:00').toISOString());
      expect(decision.endAt?.toISOString()).toBe(new Date('2026-09-04T17:00:00-03:00').toISOString());
    }
  });

  it('decide "skip" (already_synced) quando já existe event interno com o mesmo gcalId', () => {
    const decision = mapGoogleEventToSync(
      {
        gcalId: 'gcal-2',
        title: 'Reunião',
        start: { dateTime: '2026-09-04T10:00:00-03:00' },
        end: { dateTime: '2026-09-04T11:00:00-03:00' },
      },
      (gcalId) => gcalId === 'gcal-2',
    );

    expect(decision).toEqual({ action: 'skip', reason: 'already_synced' });
  });

  it('decide "skip" (all_day) para evento de dia inteiro, mesmo sem event interno correspondente', () => {
    const decision = mapGoogleEventToSync(
      {
        gcalId: 'gcal-3',
        title: 'Feriado',
        start: { date: '2026-09-07' },
        end: { date: '2026-09-08' },
      },
      () => false,
    );

    expect(decision).toEqual({ action: 'skip', reason: 'all_day' });
  });

  it('evento com horário sem end.dateTime devolve endAt undefined, sem quebrar', () => {
    const decision = mapGoogleEventToSync(
      {
        gcalId: 'gcal-4',
        title: 'Sem horário de fim',
        start: { dateTime: '2026-09-04T09:00:00-03:00' },
        end: {},
      },
      () => false,
    );

    expect(decision.action).toBe('create');
    if (decision.action === 'create') {
      expect(decision.endAt).toBeUndefined();
    }
  });
});
