/**
 * Payload do resumo de reentrada (RF-10): deliberadamente agregado, nunca
 * item a item — `pendingCount` é só "quantos itens estão parados", nunca a
 * lista deles nem quantas vezes cada um foi cobrado (proibição testada por
 * cenário, TESTING.md §4.1). Sem `snoozeCount`, sem `itemIds`.
 */
export interface ReentrySummaryData {
  readonly silentDays: number;
  readonly pendingCount: number;
}

const REENTRY_VARIATIONS = [
  (d: ReentrySummaryData) =>
    d.pendingCount > 0
      ? `Que bom te ver de volta. Ficaram ${d.pendingCount} coisa(s) parada(s) enquanto você esteve fora — sem pressa, a gente retoma no seu ritmo.`
      : 'Que bom te ver de volta. Nada parado te esperando — bora seguir de onde você quiser.',
  (d: ReentrySummaryData) =>
    d.pendingCount > 0
      ? `Voltou! Tem ${d.pendingCount} coisa(s) na lista esperando, mas isso é papo pra depois — me conta o que precisar agora.`
      : 'Voltou! A lista está tranquila — me conta o que precisar agora.',
] as const;

/**
 * Nunca pede "colocar em dia", nunca lista cobranças acumuladas — banco de
 * variações estático (RF-14, mesmo padrão de `tasks/domain/tone-templates.ts`).
 * Seleção determinística por `silentDays` para ser reproduzível em teste.
 */
export function buildReentrySummaryMessage(data: ReentrySummaryData): string {
  const index = data.silentDays % REENTRY_VARIATIONS.length;
  return REENTRY_VARIATIONS[index]!(data);
}
