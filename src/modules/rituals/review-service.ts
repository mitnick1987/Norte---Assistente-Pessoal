import type { Logger } from 'pino';
import type { LlmProvider, LlmUsage } from '../../core/llm/index.js';
import { LlmRequestError } from '../../core/llm/index.js';
import { startOfZonedDay, zonedTimeToUtc } from '../../core/scheduler/domain/timezone.js';
import type { ItemService } from '../tasks/public/index.js';
import type { HygieneService } from '../hygiene/public/index.js';
import { buildReviewData, buildReviewFallbackMessages, REVIEW_MAX_MESSAGES, type ReviewData } from './domain/index.js';

const REVIEW_MODEL = 'claude-sonnet-5';
const REVIEW_MAX_TOKENS = 1024;

/**
 * A decisão pedida nesta revisão, se houver — usado pelo job handler pra
 * registrar em `pending_menus` (achado de review: "1"/"2"/"3" precisa
 * resolver contra a última pergunta feita, não sempre contra a cobrança).
 * `origin` distingue a decisão genérica ("manter/adiar/dropar") da proposta
 * de higiene ("arquivar/dropar/adiar"): são menus com opções diferentes,
 * resolvidos por comandos diferentes.
 */
export interface ReviewPendingDecision {
  readonly origin: 'revisao' | 'higiene';
  readonly itemId: number;
}

export interface ReviewResult {
  readonly messages: readonly string[];
  readonly pendingDecision: ReviewPendingDecision | undefined;
}

export interface ReviewServiceDeps {
  readonly itemService: ItemService;
  readonly llmProvider: LlmProvider;
  readonly systemPrompt: () => string;
  readonly logger: Logger;
  readonly onUsage?: (usage: LlmUsage) => void;
  /** Ausente só em teste que não exercita a proposta de higiene — em produção sempre presente (RF-11, FEAT-007). */
  readonly hygieneService?: HygieneService;
  now?: () => Date;
}

/**
 * Orquestra a revisão noturna (RF-06): mesmo esqueleto do briefing — dados
 * coletados por código, Sonnet só redige, fallback determinístico se
 * falhar. Teto de `REVIEW_MAX_MESSAGES` é imposto na montagem dos dados
 * (`rituals/domain`), não só sugerido no prompt — mesmo a redação livre do
 * Sonnet nunca produz mais mensagens que isso, porque quem decide quantas
 * mensagens enfileirar é este serviço, não o texto que o modelo devolve.
 */
export class ReviewService {
  private readonly now: () => Date;

  constructor(private readonly deps: ReviewServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async buildMessages(): Promise<ReviewResult> {
    const data = this.collectData();
    const pendingDecision = resolvePendingDecision(data);

    try {
      const result = await this.deps.llmProvider.complete({
        model: REVIEW_MODEL,
        systemPrompt: this.deps.systemPrompt(),
        messages: [{ role: 'user', content: buildDraftingPrompt(data) }],
        maxTokens: REVIEW_MAX_TOKENS,
        cacheSystemPrompt: true,
      });

      this.deps.onUsage?.(result.usage);

      if (!result.text) {
        this.deps.logger.warn('revisão: Sonnet respondeu sem texto, caindo em fallback');
        return { messages: buildReviewFallbackMessages(data), pendingDecision };
      }

      // Redação livre do Sonnet vem como um texto só — mesma regra de
      // segmentação do fallback (spec item 6: no máximo 3 mensagens),
      // dividida por linha em branco para caber no limite de mensagens do
      // WhatsApp sem virar um parágrafo único gigante. Quando há proposta de
      // higiene, reserva-se 1 slot pra ela: o Sonnet redige só o resto
      // (completedToday/rescheduledToTomorrow), nunca a decisão em si.
      const paragraphBudget = data.hygieneMessage ? REVIEW_MAX_MESSAGES - 1 : REVIEW_MAX_MESSAGES;
      const segmented = result.text
        .split(/\n{2,}/)
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, paragraphBudget);

      if (segmented.length === 0) return { messages: buildReviewFallbackMessages(data), pendingDecision };

      // Higiene nunca é redação livre (spec, Decisões tomadas: "100% template
      // determinístico, sem Sonnet" — área mais sensível a tom do produto).
      // O texto que sai pro usuário é sempre `data.hygieneMessage` verbatim,
      // anexado como última mensagem — nunca reescrito pelo modelo.
      const messages = data.hygieneMessage ? [...segmented, data.hygieneMessage] : segmented;
      return { messages, pendingDecision };
    } catch (err) {
      if (err instanceof LlmRequestError) {
        this.deps.logger.warn({ err }, 'revisão: falha ao chamar o Sonnet, caindo em fallback determinístico');
        return { messages: buildReviewFallbackMessages(data), pendingDecision };
      }
      throw err;
    }
  }

  private collectData(): ReviewData {
    const now = this.now();
    const todayStart = zonedTimeToUtc(startOfZonedDay(now));
    const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60_000);
    const dayAfterTomorrowStart = new Date(tomorrowStart.getTime() + 24 * 60 * 60_000);

    const completedToday = this.deps.itemService
      .listByStatusUpdatedBetween('feita', todayStart, tomorrowStart)
      .map((item) => ({ title: item.title }));

    const rescheduledToTomorrow = this.deps.itemService
      .listByStatusUpdatedBetween('adiada', todayStart, tomorrowStart)
      .filter((item) => item.dueAt && new Date(item.dueAt) >= tomorrowStart && new Date(item.dueAt) < dayAfterTomorrowStart)
      .map((item) => ({ title: item.title }));

    const eligibleForDecision = this.deps.itemService
      .list({ includeInbox: false })
      .filter((item) => item.dueAt && new Date(item.dueAt) < now);

    // Higiene (RF-11) é sempre calculada e, se houver candidato, substitui a
    // pergunta genérica — a mensagem já vem pronta de `hygiene/public` porque
    // a régua de tom da proposta pertence àquele módulo, não a este.
    const hygieneProposal = this.deps.hygieneService?.findProposal();
    const hygieneMessage = hygieneProposal ? this.deps.hygieneService!.buildMessage(hygieneProposal) : undefined;

    return buildReviewData(
      completedToday,
      rescheduledToTomorrow,
      eligibleForDecision,
      hygieneMessage,
      hygieneProposal?.itemId,
    );
  }
}

/** Higiene substitui a decisão genérica (spec item 4: nunca soma) — mesma prioridade usada na montagem da mensagem. */
function resolvePendingDecision(data: ReviewData): ReviewPendingDecision | undefined {
  if (data.hygieneMessage && data.hygieneItemId !== undefined) {
    return { origin: 'higiene', itemId: data.hygieneItemId };
  }
  if (data.decisionRequested) {
    return { origin: 'revisao', itemId: data.decisionRequested.id };
  }
  return undefined;
}

function buildDraftingPrompt(data: ReviewData): string {
  const completedText =
    data.completedToday.length > 0 ? data.completedToday.map((e) => `- ${e.title}`).join('\n') : '(nada fechado hoje)';
  const rescheduledText =
    data.rescheduledToTomorrow.length > 0
      ? data.rescheduledToTomorrow.map((e) => `- ${e.title}`).join('\n')
      : '(nada reagendado para amanhã)';

  // Higiene é 100% determinística (spec, Decisões tomadas) — o Sonnet nunca
  // redige nem reformula essa parte, só sabe que ela existe pra não tentar
  // pedir uma segunda decisão no mesmo ciclo. O texto final é anexado depois
  // (buildMessages), sempre verbatim.
  const decisionSection = data.hygieneMessage
    ? 'Não peça nenhuma decisão ao usuário nesta redação — uma pergunta de organização da lista já vai ser enviada separadamente, em mensagem própria.'
    : data.decisionRequested
      ? `No máximo uma decisão a pedir ao usuário sobre: "${data.decisionRequested.title}"\nPergunte objetivamente o que ele quer fazer, oferecendo manter, adiar ou dropar.`
      : 'No máximo uma decisão a pedir ao usuário sobre: (nenhuma decisão pendente)';

  return `Redija a revisão noturna de hoje a partir destes dados (não invente nada além do que está aqui):

O que fechou hoje:
${completedText}

O que ficou para amanhã (já reagendado automaticamente, sem culpa):
${rescheduledText}

${decisionSection}

Escreva no máximo ${REVIEW_MAX_MESSAGES} parágrafos curtos, separados por linha em branco — cada parágrafo vira uma mensagem separada. Nunca cite quantas vezes algo já aconteceu antes. Responda só com o texto final, sem preâmbulo.`;
}
