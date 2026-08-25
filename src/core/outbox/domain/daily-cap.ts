/**
 * Teto diário de mensagens proativas — imposto aqui, nunca só sugerido ao
 * LLM via prompt (SECURITY.md §2). O chamador injeta a contagem já feita
 * (janela do dia em America/Sao_Paulo); esta função é só a regra pura de
 * corte, testável sem tocar o banco.
 */
export function proactiveCapReached(sentToday: number, dailyCap: number): boolean {
  return sentToday >= dailyCap;
}
