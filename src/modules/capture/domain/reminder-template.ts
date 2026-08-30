/**
 * Template determinístico do lembrete pontual (RF-03): caminho crítico
 * 100% sem LLM — disparado pelo scheduler (core/scheduler), nunca por
 * decisão do modelo. Mensagem única, sem variação: lembrete não é o lugar
 * para criatividade de copy, é o lugar para confiabilidade.
 */
export function buildPointReminderMessage(title: string): string {
  return `Lembrete: ${title}`;
}
