import { describe, expect, it, vi } from 'vitest';
import { buildGoogleCalendarTools, CreateEventToolError } from '../../src/modules/integrations/google-calendar/tools.js';
import {
  GoogleTokenRefreshError,
  InvalidEventDateError,
} from '../../src/modules/integrations/google-calendar/google-calendar-service.js';
import type { GoogleCalendarService } from '../../src/modules/integrations/google-calendar/google-calendar-service.js';
import { AuthTokenNotFoundError } from '../../src/modules/integrations/google-calendar/domain/index.js';

const TEST_CTX = { messageId: 42 };

function buildServiceStub(createEventFromBrain: ReturnType<typeof vi.fn>): GoogleCalendarService {
  return { createEventFromBrain } as unknown as GoogleCalendarService;
}

describe('tool create_event (ADR-019, FEAT-006)', () => {
  it('input válido (ISO absoluto) delega ao serviço com startAt/endAt convertidos e sourceMessageId do turno', async () => {
    const createEventFromBrain = vi.fn().mockResolvedValue({ itemId: 1, eventId: 2, gcalId: 'gcal-1' });
    const [tool] = buildGoogleCalendarTools(buildServiceStub(createEventFromBrain));

    const parsed = tool!.inputSchema.parse({
      title: 'Reunião',
      startAt: '2026-09-04T13:00:00.000Z',
      endAt: '2026-09-04T14:00:00.000Z',
    });
    const result = await tool!.handler(parsed, TEST_CTX);

    expect(result).toEqual({ itemId: 1, eventId: 2, gcalId: 'gcal-1' });
    expect(createEventFromBrain).toHaveBeenCalledWith({
      title: 'Reunião',
      startAt: new Date('2026-09-04T13:00:00.000Z'),
      endAt: new Date('2026-09-04T14:00:00.000Z'),
      sourceMessageId: 42,
    });
  });

  it('endAt ausente aplica duração default de 1h', async () => {
    const createEventFromBrain = vi.fn().mockResolvedValue({ itemId: 1, eventId: 2, gcalId: 'gcal-1' });
    const [tool] = buildGoogleCalendarTools(buildServiceStub(createEventFromBrain));

    const parsed = tool!.inputSchema.parse({ title: 'Call', startAt: '2026-09-04T13:00:00.000Z' });
    await tool!.handler(parsed, TEST_CTX);

    expect(createEventFromBrain).toHaveBeenCalledWith(
      expect.objectContaining({ endAt: new Date('2026-09-04T14:00:00.000Z') }),
    );
  });

  it('schema é strict — campo desconhecido é rejeitado (additionalProperties: false)', () => {
    const [tool] = buildGoogleCalendarTools(buildServiceStub(vi.fn()));

    expect(() =>
      tool!.inputSchema.parse({
        title: 'Reunião',
        startAt: '2026-09-04T13:00:00.000Z',
        campoInventado: 'x',
      }),
    ).toThrow();
  });

  it('data que não é ISO válido é rejeitada pelo schema, sem chegar ao handler', () => {
    const [tool] = buildGoogleCalendarTools(buildServiceStub(vi.fn()));

    expect(() => tool!.inputSchema.parse({ title: 'Reunião', startAt: 'sexta 10h' })).toThrow();
  });

  it('InvalidEventDateError vira erro curto sem detalhe interno', async () => {
    const createEventFromBrain = vi.fn().mockRejectedValue(new InvalidEventDateError('in_past'));
    const [tool] = buildGoogleCalendarTools(buildServiceStub(createEventFromBrain));
    const parsed = tool!.inputSchema.parse({ title: 'x', startAt: '2026-09-04T13:00:00.000Z' });

    await expect(tool!.handler(parsed, TEST_CTX)).rejects.toThrow(CreateEventToolError);
    await expect(tool!.handler(parsed, TEST_CTX)).rejects.not.toThrow(/in_past/);
  });

  it('AuthTokenNotFoundError e GoogleTokenRefreshError viram o mesmo erro genérico de acesso', async () => {
    const [tool] = buildGoogleCalendarTools(
      buildServiceStub(vi.fn().mockRejectedValue(new AuthTokenNotFoundError('google_calendar'))),
    );
    const parsed = tool!.inputSchema.parse({ title: 'x', startAt: '2026-09-04T13:00:00.000Z' });

    await expect(tool!.handler(parsed, TEST_CTX)).rejects.toThrow(CreateEventToolError);
  });

  it('falha de rede/erro desconhecido também vira CreateEventToolError, nunca propaga cru', async () => {
    const [tool] = buildGoogleCalendarTools(
      buildServiceStub(vi.fn().mockRejectedValue(new Error('ECONNRESET'))),
    );
    const parsed = tool!.inputSchema.parse({ title: 'x', startAt: '2026-09-04T13:00:00.000Z' });

    await expect(tool!.handler(parsed, TEST_CTX)).rejects.toThrow(CreateEventToolError);
    await expect(tool!.handler(parsed, TEST_CTX)).rejects.not.toThrow(/ECONNRESET/);
  });

  it('erro de GoogleTokenRefreshError também vira erro de acesso genérico', async () => {
    const [tool] = buildGoogleCalendarTools(
      buildServiceStub(vi.fn().mockRejectedValue(new GoogleTokenRefreshError(new Error('refresh falhou')))),
    );
    const parsed = tool!.inputSchema.parse({ title: 'x', startAt: '2026-09-04T13:00:00.000Z' });

    await expect(tool!.handler(parsed, TEST_CTX)).rejects.toThrow(CreateEventToolError);
  });
});
