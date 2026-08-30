import type { ItemService } from '../tasks/public/index.js';
import { buildHygieneMessage, buildHygieneProposal, selectHygieneCandidate, type HygieneProposal } from './domain/index.js';

export interface HygieneServiceDeps {
  readonly itemService: ItemService;
  now?: () => Date;
}

/**
 * Único ponto de leitura de `hygiene` para fora do módulo (consumido por
 * `rituals` via `hygiene/public`, RF-11): seleciona o candidato mais antigo
 * elegível (3+ adiamentos OU 21+ dias parado) entre os itens ativos e monta
 * a mensagem 100% determinística — nunca soma decisão além do que a revisão
 * noturna já pede (spec item 4: substitui a decisão genérica quando houver
 * candidato, não soma).
 */
export class HygieneService {
  private readonly now: () => Date;

  constructor(private readonly deps: HygieneServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  findProposal(): HygieneProposal | undefined {
    const now = this.now();
    const items = this.deps.itemService.list({ includeInbox: false });
    const candidate = selectHygieneCandidate(
      items.map((item) => ({ id: item.id, title: item.title, snoozeCount: item.snoozeCount, updatedAt: item.updatedAt })),
      now,
    );
    if (!candidate) return undefined;

    return buildHygieneProposal(candidate, now);
  }

  buildMessage(proposal: HygieneProposal): string {
    return buildHygieneMessage(proposal, proposal.itemId);
  }
}
