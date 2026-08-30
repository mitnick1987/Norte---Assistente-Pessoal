/**
 * Anti-flood de alerta (FEAT-008, spec item 1): mesma chave lógica (tipo +
 * identificador do recurso) não dispara de novo dentro da janela — janela
 * por chave, não contagem global, para uma sessão caída não consumir a cota
 * que impediria um alerta de disco de sair (Decisões tomadas da spec).
 */
export function shouldSendAlert(lastSentAt: Date | undefined, now: Date, windowMs: number): boolean {
  if (!lastSentAt) return true;
  return now.getTime() - lastSentAt.getTime() >= windowMs;
}
