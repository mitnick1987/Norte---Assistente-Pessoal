import type { Logger } from 'pino';
import type { LlmProvider, LlmUsage } from '../../core/llm/index.js';
import { LlmRequestError } from '../../core/llm/index.js';
import type { ItemService } from '../tasks/public/index.js';
import { buildBriefingData, buildBriefingFallbackMessage, type BriefingAgendaEntry } from './domain/index.js';

const BRIEFING_MODEL = 'claude-sonnet-5';
const BRIEFING_MAX_TOKENS = 1024;

export interface RemoteAgendaPort {
  listTodayAndSync(): Promise<readonly { readonly title: string; readonly startAt: string }[]>;
}

export interface BriefingServiceDeps {
  readonly itemService: ItemService;
  readonly llmProvider: LlmProvider;
  readonly systemPrompt: () => string;
  readonly logger: Logger;
  readonly onUsage?: (usage: LlmUsage) => void;
  /** Ausente quando o Google nunca foi autorizado (ADR-019) — briefing sai sem seção de agenda, nunca falha por isso. */
  readonly agendaPort?: RemoteAgendaPort;
  now?: () => Date;
}

/**
 * Orquestra o briefing matinal (RF-05): coleta dados por código
 * (`rituals/domain`, função pura), pede ao Sonnet para só **redigir** em
 * cima deles — sem tool use nesta chamada, o modelo não tem `list_items`
 * irrestrito (spec item 5). Erro/timeout do Sonnet cai no template de
 * fallback com os mesmos dados: o briefing sai de um jeito ou de outro
 * (ADR-006).
 */
export class BriefingService {
  private readonly now: () => Date;

  constructor(private readonly deps: BriefingServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async buildMessage(): Promise<string> {
    const agenda = await this.collectAgenda();
    const priorities = this.deps.itemService.list({ includeInbox: false });
    const data = buildBriefingData(agenda, priorities);

    try {
      const result = await this.deps.llmProvider.complete({
        model: BRIEFING_MODEL,
        systemPrompt: this.deps.systemPrompt(),
        messages: [{ role: 'user', content: buildDraftingPrompt(data) }],
        maxTokens: BRIEFING_MAX_TOKENS,
        cacheSystemPrompt: true,
      });

      this.deps.onUsage?.(result.usage);

      if (!result.text) {
        this.deps.logger.warn('briefing: Sonnet respondeu sem texto, caindo em fallback');
        return buildBriefingFallbackMessage(data);
      }

      return result.text;
    } catch (err) {
      if (err instanceof LlmRequestError) {
        this.deps.logger.warn({ err }, 'briefing: falha ao chamar o Sonnet, caindo em fallback determinístico');
        return buildBriefingFallbackMessage(data);
      }
      throw err;
    }
  }

  private async collectAgenda(): Promise<BriefingAgendaEntry[]> {
    if (!this.deps.agendaPort) return [];

    try {
      const events = await this.deps.agendaPort.listTodayAndSync();
      return events.map((e) => ({ title: e.title, startAt: e.startAt }));
    } catch (err) {
      this.deps.logger.warn({ err }, 'briefing: falha ao sincronizar agenda do Google, seguindo sem ela');
      return [];
    }
  }
}

function buildDraftingPrompt(data: ReturnType<typeof buildBriefingData>): string {
  const agendaText =
    data.agenda.length > 0 ? data.agenda.map((e) => `- ${e.title} às ${e.startAt}`).join('\n') : '(sem compromissos hoje)';
  const prioritiesText =
    data.priorities.length > 0 ? data.priorities.map((p) => `- ${p.title}`).join('\n') : '(sem prioridades no momento)';
  const microStepText = data.microStep ?? '(sem micropasso sugerido)';

  return `Redija o briefing matinal de hoje a partir destes dados (não invente nada além do que está aqui, não pergunte por mais informação):

Agenda de hoje:
${agendaText}

Até 3 prioridades:
${prioritiesText}

Primeiro micropasso sugerido para a prioridade 1:
${microStepText}

Termine com uma pergunta curta e acionável do tipo "qual você encara primeiro?". Responda só com o texto final da mensagem, sem preâmbulo.`;
}
