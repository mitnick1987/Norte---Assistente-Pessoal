/**
 * Anti-flood de alerta (FEAT-008, spec item 1): mesma chave lógica (tipo +
 * identificador do recurso) não dispara de novo dentro da janela — janela
 * por chave, não contagem global, para uma sessão caída não consumir a cota
 * que impediria um alerta de disco de sair (Decisões tomadas da spec).
 *
 * Especificação pura da regra, mantida como documentação executável e
 * cobertura de unidade dos limites (>=/<) — a decisão de fato em runtime
 * roda atomicamente dentro do SQL de `AlertDispatchRepository.tryClaim`
 * (achado de review FEAT-008: o par check-then-act antigo, que chamava esta
 * função antes do envio assíncrono, tinha corrida entre disparos
 * concorrentes). As duas expressam a mesma regra; mudar o limite aqui exige
 * mudar o `WHERE` de `tryClaim` também.
 */
export function shouldSendAlert(lastSentAt: Date | undefined, now: Date, windowMs: number): boolean {
  if (!lastSentAt) return true;
  return now.getTime() - lastSentAt.getTime() >= windowMs;
}
