import { z } from 'zod';
import type { ToolDefinition } from '../../../core/kernel/types.js';
import { GoogleTokenRefreshError, InvalidEventDateError } from './google-calendar-service.js';
import type { GoogleCalendarService } from './google-calendar-service.js';
import { AuthTokenNotFoundError } from './domain/index.js';

/** Mesmo default da captura determinística (spec item 2, `DEFAULT_EVENT_DURATION_MS` em `capture-service.ts`) — um único número, sem duplicar a constante entre os dois consumidores do serviço. */
const DEFAULT_EVENT_DURATION_MS = 60 * 60_000;

const createEventInputSchema = z
  .object({
    title: z.string().min(1).max(500),
    /**
     * ISO absoluto (spec item 2, ADR-006): o brain resolve "sexta 10h" a
     * partir da data/hora injetada na última mensagem do usuário — a tool
     * nunca recebe expressão relativa, e o backend ainda revalida o
     * intervalo antes de aceitar (validateEventDates).
     */
    startAt: z.string().datetime(),
    endAt: z.string().datetime().optional(),
    local: z.string().min(1).max(300).optional(),
  })
  .strict();
type CreateEventInput = z.infer<typeof createEventInputSchema>;

export interface CreateEventToolOutput {
  readonly itemId: number;
  readonly eventId: number;
  readonly gcalId: string;
}

/**
 * Erro de tool sempre curto e sem detalhe interno (spec item 2 e 1): o
 * modelo usa isso para formular a resposta ao usuário ("não consegui marcar
 * no Calendar agora, mas anotei") — nunca token/refresh/stack trace.
 */
export class CreateEventToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CreateEventToolError';
  }
}

/**
 * Tool `create_event` do brain (ADR-019, FEAT-006 item 2): único ponto em
 * que o Sonnet decide escrever no Google Calendar — sempre pelo mesmo
 * `GoogleCalendarService` que o caminho determinístico da captura usa,
 * nunca uma chamada de API própria.
 */
export function buildGoogleCalendarTools(service: GoogleCalendarService): ToolDefinition[] {
  const createEvent: ToolDefinition<CreateEventInput> = {
    name: 'create_event',
    description:
      'Cria um compromisso no Google Calendar e no task-store a partir de um horário já resolvido em ISO absoluto (nunca calcule datas relativas você mesmo).',
    inputSchema: createEventInputSchema,
    async handler(input, ctx): Promise<CreateEventToolOutput> {
      const startAt = new Date(input.startAt);
      const endAt = input.endAt ? new Date(input.endAt) : new Date(startAt.getTime() + DEFAULT_EVENT_DURATION_MS);

      try {
        const created = await service.createEventFromBrain({
          title: input.title,
          startAt,
          endAt,
          sourceMessageId: ctx.messageId,
          ...(input.local !== undefined ? { local: input.local } : {}),
        });
        return created;
      } catch (err) {
        if (err instanceof InvalidEventDateError) {
          throw new CreateEventToolError('essa data não parece válida — confirme o dia e horário e tente de novo.');
        }
        if (err instanceof AuthTokenNotFoundError || err instanceof GoogleTokenRefreshError) {
          throw new CreateEventToolError('não consegui acessar o Google Calendar agora.');
        }
        throw new CreateEventToolError('não consegui marcar no Calendar agora.');
      }
    },
  };

  return [createEvent as unknown as ToolDefinition];
}
