/**
 * Pub/sub síncrono interno — módulos conversam entre si só por eventos
 * (ADR-011), nunca chamando função de outro módulo diretamente. Efeitos
 * assíncronos (mensagem, job) são responsabilidade de quem assina, não do
 * bus: aqui é só notificação, sem fila nem retry — isso vive em jobs/outbox.
 *
 * Entrega é best-effort e isolada por assinante: um handler que lança não
 * impede os demais de rodar (ex.: se `chains` falhar ao reagir a
 * `item.dropped`, `capture` ainda precisa processar o próprio efeito). O
 * erro é logado e não propaga para `emit` — não existe retry aqui porque
 * este bus não é durável; qualquer efeito que precise sobreviver a uma
 * falha pertence à tabela `jobs` (ADR-004), não a um handler de evento.
 */
export type EventHandler<TPayload> = (payload: TPayload) => void | Promise<void>;

/** Assinatura mínima de logger que o bus precisa — compatível com `pino.Logger` e com o logger de teste. */
export interface EventBusLogger {
  error: (obj: Record<string, unknown>, msg: string) => void;
}

export interface EventBusDeps {
  readonly logger?: EventBusLogger;
}

const noopLogger: EventBusLogger = { error: () => undefined };

export class EventBus<TEvents extends object> {
  private readonly handlers = new Map<keyof TEvents, Set<EventHandler<unknown>>>();
  private readonly logger: EventBusLogger;

  constructor(deps: EventBusDeps = {}) {
    this.logger = deps.logger ?? noopLogger;
  }

  on<K extends keyof TEvents>(event: K, handler: EventHandler<TEvents[K]>): void {
    const set = this.handlers.get(event) ?? new Set();
    set.add(handler as EventHandler<unknown>);
    this.handlers.set(event, set);
  }

  async emit<K extends keyof TEvents>(event: K, payload: TEvents[K]): Promise<void> {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of set) {
      try {
        await handler(payload);
      } catch (err) {
        this.logger.error({ event, err }, 'falha ao processar handler de evento');
      }
    }
  }
}
