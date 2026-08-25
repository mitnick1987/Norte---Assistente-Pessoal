/**
 * Pub/sub síncrono interno — módulos conversam entre si só por eventos
 * (ADR-011), nunca chamando função de outro módulo diretamente. Efeitos
 * assíncronos (mensagem, job) são responsabilidade de quem assina, não do
 * bus: aqui é só notificação, sem fila nem retry — isso vive em jobs/outbox.
 */
export type EventHandler<TPayload> = (payload: TPayload) => void | Promise<void>;

export class EventBus<TEvents extends object> {
  private readonly handlers = new Map<keyof TEvents, Set<EventHandler<unknown>>>();

  on<K extends keyof TEvents>(event: K, handler: EventHandler<TEvents[K]>): void {
    const set = this.handlers.get(event) ?? new Set();
    set.add(handler as EventHandler<unknown>);
    this.handlers.set(event, set);
  }

  async emit<K extends keyof TEvents>(event: K, payload: TEvents[K]): Promise<void> {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of set) {
      await handler(payload);
    }
  }
}
