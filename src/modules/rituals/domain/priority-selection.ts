/**
 * Recorte mínimo de item que a seleção de prioridades do briefing precisa —
 * função pura, sem I/O (ARCHITECTURE.md §4). Nunca `snoozeCount`: o tipo não
 * tem o campo, então a omissão no payload de redação é estrutural, não uma
 * questão de lembrar de filtrar (mesma garantia de `tasks/tools.ts`).
 */
export interface PrioritizableItem {
  readonly id: number;
  readonly title: string;
  readonly priority: 1 | 2 | 3 | null;
  readonly dueAt: string | null;
}

/**
 * Ordena por prazo mais próximo primeiro (item sem prazo vai depois de
 * qualquer item com prazo) e usa prioridade explícita (1 é mais urgente)
 * como critério de desempate — nunca aleatório, para o mesmo estado do
 * task-store sempre produzir a mesma seleção (verificável em teste).
 */
export function selectTopPriorities(items: readonly PrioritizableItem[], maxCount: number): PrioritizableItem[] {
  const sorted = [...items].sort((a, b) => {
    const aDue = a.dueAt ? new Date(a.dueAt).getTime() : Number.POSITIVE_INFINITY;
    const bDue = b.dueAt ? new Date(b.dueAt).getTime() : Number.POSITIVE_INFINITY;
    if (aDue !== bDue) return aDue - bDue;

    const aPriority = a.priority ?? 3;
    const bPriority = b.priority ?? 3;
    if (aPriority !== bPriority) return aPriority - bPriority;

    return a.id - b.id;
  });

  return sorted.slice(0, maxCount);
}
