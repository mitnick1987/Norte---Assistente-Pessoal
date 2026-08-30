/**
 * Recorte de item que a elegibilidade de higiene precisa — inclui
 * `snoozeCount`/`updatedAt` porque são o próprio critério (RF-11), mas o
 * tipo de SAÍDA (`HygieneProposal`, ./proposal.ts) nunca carrega esses
 * campos: a garantia de "nunca exposto ao usuário" vive na fronteira entre
 * os dois tipos, não em lembrar de filtrar na hora de montar a mensagem
 * (mesmo padrão de `tasks/domain/priority-selection.ts`).
 */
export interface HygieneCandidateItem {
  readonly id: number;
  readonly title: string;
  readonly snoozeCount: number;
  /** ISO, UTC — comparado em America/Sao_Paulo só na borda (parado >= 21 dias). */
  readonly updatedAt: string;
}

const SNOOZE_COUNT_THRESHOLD = 3;
const STALE_DAYS_THRESHOLD = 21;
const STALE_MS_THRESHOLD = STALE_DAYS_THRESHOLD * 24 * 60 * 60 * 1000;

/**
 * Elegível quando adiado 3+ vezes OU parado (sem mudança de status) há 21+
 * dias — os dois critérios são independentes (spec item 4: "OU"), um item
 * recém-modificado com poucos adiamentos nunca entra aqui.
 */
export function isHygieneEligible(item: HygieneCandidateItem, now: Date): boolean {
  if (item.snoozeCount >= SNOOZE_COUNT_THRESHOLD) return true;

  const staleForMs = now.getTime() - new Date(item.updatedAt).getTime();
  return staleForMs >= STALE_MS_THRESHOLD;
}

/**
 * Igual a `selectReviewDecisionCandidate` (rituals/domain, FEAT-006): item
 * mais antigo primeiro é o critério determinístico simples exigido pela spec
 * — nunca mais de uma proposta de higiene por revisão (teto imposto aqui, na
 * seleção, não só no texto).
 */
export function selectHygieneCandidate(items: readonly HygieneCandidateItem[], now: Date): HygieneCandidateItem | undefined {
  const eligible = items.filter((item) => isHygieneEligible(item, now));
  if (eligible.length === 0) return undefined;

  return [...eligible].sort((a, b) => a.id - b.id)[0];
}
