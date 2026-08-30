import type { Logger } from 'pino';
import type { LlmProvider, LlmUsage } from '../../core/llm/index.js';
import { LlmRequestError } from '../../core/llm/index.js';
import { startOfZonedDay, zonedTimeToUtc } from '../../core/scheduler/domain/timezone.js';
import type { ItemService } from '../tasks/public/index.js';
import { buildReviewData, buildReviewFallbackMessages, REVIEW_MAX_MESSAGES, type ReviewData } from './domain/index.js';

const REVIEW_MODEL = 'claude-sonnet-5';
const REVIEW_MAX_TOKENS = 1024;

export interface ReviewServiceDeps {
  readonly itemService: ItemService;
  readonly llmProvider: LlmProvider;
  readonly systemPrompt: () => string;
  readonly logger: Logger;
  readonly onUsage?: (usage: LlmUsage) => void;
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

  async buildMessages(): Promise<string[]> {
    const data = this.collectData();

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
        return buildReviewFallbackMessages(data);
      }

      // Redação livre do Sonnet vem como um texto só — mesma regra de
      // segmentação do fallback (spec item 6: no máximo 3 mensagens),
      // dividida por linha em branco para caber no limite de mensagens do
      // WhatsApp sem virar um parágrafo único gigante.
      const segmented = result.text
        .split(/\n{2,}/)
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, REVIEW_MAX_MESSAGES);

      return segmented.length > 0 ? segmented : buildReviewFallbackMessages(data);
    } catch (err) {
      if (err instanceof LlmRequestError) {
        this.deps.logger.warn({ err }, 'revisão: falha ao chamar o Sonnet, caindo em fallback determinístico');
        return buildReviewFallbackMessages(data);
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

    return buildReviewData(completedToday, rescheduledToTomorrow, eligibleForDecision);
  }
}

function buildDraftingPrompt(data: ReviewData): string {
  const completedText =
    data.completedToday.length > 0 ? data.completedToday.map((e) => `- ${e.title}`).join('\n') : '(nada fechado hoje)';
  const rescheduledText =
    data.rescheduledToTomorrow.length > 0
      ? data.rescheduledToTomorrow.map((e) => `- ${e.title}`).join('\n')
      : '(nada reagendado para amanhã)';
  const decisionText = data.decisionRequested ? `"${data.decisionRequested.title}"` : '(nenhuma decisão pendente)';

  return `Redija a revisão noturna de hoje a partir destes dados (não invente nada além do que está aqui):

O que fechou hoje:
${completedText}

O que ficou para amanhã (já reagendado automaticamente, sem culpa):
${rescheduledText}

No máximo uma decisão a pedir ao usuário sobre: ${decisionText}
${data.decisionRequested ? 'Pergunte objetivamente o que ele quer fazer, oferecendo manter, adiar ou dropar.' : ''}

Escreva no máximo ${REVIEW_MAX_MESSAGES} parágrafos curtos, separados por linha em branco — cada parágrafo vira uma mensagem separada. Nunca cite quantas vezes algo já aconteceu antes. Responda só com o texto final, sem preâmbulo.`;
}
