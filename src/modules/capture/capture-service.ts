import type { Database } from 'better-sqlite3';
import type { Logger } from 'pino';
import type { JobRepository } from '../../core/scheduler/index.js';
import { parseRelativeDatePtBr, type EventRecord, type EventService, type ItemService } from '../tasks/public/index.js';
import type { ChainService } from '../chains/public/index.js';
import type { TriageItem } from './domain/index.js';

export interface CapturedItem {
  readonly id: number;
  readonly title: string;
  /** `true` quando o item tinha `dueExpression` mas o parser não reconheceu — usado para a confirmação avisar que não entendeu a data, sem perguntar estrutura. */
  readonly dueExpressionUnresolved: boolean;
}

/**
 * Porta estreita (ADR-019, opção A): só o que a captura precisa do módulo
 * `google-calendar`, nunca a classe inteira — mantém `capture` sem depender
 * de OAuth/cifra/refresh, e o teste stuba só isto.
 */
export interface RemoteCalendarPort {
  createRemoteEvent(params: {
    readonly title: string;
    readonly startAt: Date;
    readonly endAt: Date;
    readonly local?: string;
  }): Promise<{ readonly gcalId: string }>;
}

/** Duração assumida quando a triagem só resolve o horário de início — a mesma janela usada nos exemplos de agenda do produto; sem isso a API do Google exige um fim explícito. */
const DEFAULT_EVENT_DURATION_MS = 60 * 60_000;

export interface CaptureServiceDeps {
  readonly itemService: ItemService;
  readonly eventService: EventService;
  readonly chainService: ChainService;
  readonly jobRepository: JobRepository;
  readonly db: Database;
  /** Deslocamento aplicado ao evento no momento da criação (FEAT-004, spec item 1) — lido a cada captura, não fixado no boot. */
  readonly getDeslocamentoMinDefault: () => number;
  /**
   * Ausente quando o dono nunca autorizou o Google (env sem credenciais,
   * `buildApp` não monta o módulo) — captura segue funcionando 100% sem
   * Calendar, só sem o evento remoto (ADR-019, degradação graciosa).
   */
  readonly googleCalendarService?: RemoteCalendarPort;
  readonly logger: Logger;
}

/**
 * Ponte entre a triagem e o task-store (RF-01): toda escrita passa pelo
 * `ItemService` (que por sua vez só grava via repository do módulo tasks) —
 * nunca SQL direto, mesmo estando em outro módulo (ARCHITECTURE.md §2).
 *
 * Item `compromisso` com `dueAt` resolvido vira `event` + cadeia inteira
 * (RF-04, FEAT-004: `chains` reage a `events` via o contrato público de
 * `tasks`, mas quem aciona a criação da cadeia é este serviço — a mesma
 * relação que já existia entre `capture` e o job pontual da FEAT-002).
 * Qualquer outro tipo com `dueAt` resolvido segue exatamente como antes: job
 * `reminder` avulso, sem `event`, sem cadeia.
 *
 * `db` é usado só para abrir a transação que engloba item+job(s) de uma
 * mesma posição (better-sqlite3: mesma conexão de todos os repositories
 * envolvidos, passados de fora) — o serviço continua sem SQL direto, a
 * transação só orquestra as escritas que já existiam.
 */
export class CaptureService {
  constructor(private readonly deps: CaptureServiceDeps) {}

  /**
   * `sourceMessageId` + `source_item_index` (posição do item na extração,
   * 0-based) é a chave de idempotência do reprocessamento (ADR-018),
   * GRANULAR POR ITEM: uma captura de N itens que crashou entre o item 0 e o
   * item 1 deixava a varredura ver "já existe item dessa mensagem" e pular
   * 1..N-1 para sempre (perda parcial permanente) — agora ela só pula os
   * índices já gravados e completa o resto. Item+job(s) de uma mesma posição
   * são gravados numa única transação: crash entre eles nunca deixa um item
   * órfão sem lembrete (o retry refaz a posição inteira).
   *
   * `now` resolve `dueExpression` (ADR-006): o Haiku devolve a expressão
   * relativa em PT-BR, nunca uma data absoluta — quem calcula é sempre o
   * backend, determinístico e testável, nunca o modelo (ele não tem como
   * saber que dia é hoje). Expressão que o parser não reconhece não vira
   * dueAt nenhum: o item vai pra inbox e a confirmação avisa que não
   * entendeu a data, sem fazer pergunta de estrutura.
   */
  async captureItems(items: readonly TriageItem[], sourceMessageId: number, now: Date): Promise<CapturedItem[]> {
    const alreadyCaptured = this.deps.itemService.findCapturedItemIndexes(sourceMessageId);

    const captureOne = this.deps.db.transaction(
      (item: TriageItem, sourceItemIndex: number): { captured: CapturedItem; event: EventRecord | undefined } => {
        const parsed = item.dueExpression ? parseRelativeDatePtBr(item.dueExpression, now) : undefined;
        const dueExpressionUnresolved = Boolean(item.dueExpression) && !parsed;

        const created = this.deps.itemService.create({
          type: item.type,
          title: item.title,
          origin: 'texto',
          status: item.ambiguous || dueExpressionUnresolved ? 'inbox' : 'ativa',
          sourceMessageId,
          sourceItemIndex,
          ...(parsed ? { dueAt: parsed.dueAt } : {}),
        });

        let event: EventRecord | undefined;
        if (parsed && item.type === 'compromisso') {
          event = this.deps.eventService.create({
            itemId: created.id,
            title: created.title,
            startAt: parsed.dueAt,
            deslocamentoMin: this.deps.getDeslocamentoMinDefault(),
          });
          this.deps.chainService.scheduleForEvent(event);
        } else if (parsed) {
          this.deps.jobRepository.create({
            type: 'reminder',
            payload: { itemId: created.id, title: created.title },
            nextRunAt: parsed.dueAt,
          });
        }

        return { captured: { id: created.id, title: created.title, dueExpressionUnresolved }, event };
      },
    );

    const result: CapturedItem[] = [];
    for (const [sourceItemIndex, item] of items.entries()) {
      if (alreadyCaptured.has(sourceItemIndex)) continue;

      const { captured, event } = captureOne(item, sourceItemIndex);
      result.push(captured);

      // Escrita no Google fica fora da transação SQLite (I/O de rede não pode
      // segurar o `db.transaction` síncrono do better-sqlite3) — o event
      // interno + cadeia já estão persistidos nesse ponto; o gcal_id chega
      // depois, por um update à parte (ADR-019, opção A).
      if (event) await this.createRemoteEventFor(event);
    }

    return result;
  }

  /**
   * Falha ou ausência do Google nunca vira erro de captura (ADR-019): sem
   * tokens autorizados ou qualquer falha na chamada, o evento interno e a
   * cadeia já criados bastam — o dono nem percebe que o Google ficou de
   * fora. `event.gcalId` já preenchido (evento nascido da sincronização de
   * leitura, por exemplo) é reaproveitado sem chamar o Google de novo.
   */
  private async createRemoteEventFor(event: EventRecord): Promise<void> {
    if (!this.deps.googleCalendarService) return;
    if (event.gcalId) return;

    try {
      const startAt = new Date(event.startAt);
      const endAt = event.endAt ? new Date(event.endAt) : new Date(startAt.getTime() + DEFAULT_EVENT_DURATION_MS);

      const remote = await this.deps.googleCalendarService.createRemoteEvent({
        title: event.title,
        startAt,
        endAt,
        ...(event.local ? { local: event.local } : {}),
      });

      this.deps.eventService.setGcalId(event.id, remote.gcalId);
    } catch (err) {
      this.deps.logger.warn({ err, eventId: event.id }, 'falha ao criar evento remoto no Google Calendar — mantendo só o evento interno');
    }
  }
}
