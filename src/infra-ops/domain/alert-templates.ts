/**
 * Templates determinísticos dos e-mails de alerta — canal técnico para o
 * operador, sem tom conversacional do WhatsApp (não passa pela régua RSD do
 * produto, mas ainda é direto e sem alarmismo desnecessário).
 */

export function sessionDownMessage(state: string): { subject: string; text: string } {
  return {
    subject: 'Norte: sessão do WhatsApp caiu',
    text: `Estado atual: ${state}. Escaneie o QR code novamente para reconectar a sessão.`,
  };
}

export function deliveryExhaustedMessage(message: { id: number; jid: string; attempts: number }): {
  subject: string;
  text: string;
} {
  return {
    subject: 'Norte: falha ao entregar mensagem',
    text: `Mensagem ${message.id} (jid ${message.jid}) esgotou ${message.attempts} tentativas de envio e não foi entregue.`,
  };
}

export function refreshFailureMessage(provider: string): { subject: string; text: string } {
  return {
    subject: `Norte: falha ao renovar credencial (${provider})`,
    text: `O refresh de token de ${provider} falhou. Pode ser necessário reautorizar o acesso.`,
  };
}

export function anchorRitualCappedMessage(message: { id: number; jid: string }): { subject: string; text: string } {
  return {
    subject: 'Norte: briefing/revisão represado pelo teto diário',
    text: `Mensagem ${message.id} (jid ${message.jid}) de briefing ou revisão foi represada pelo teto diário de proativas.`,
  };
}

export function diskUsageMessage(context: { usagePercent: number; thresholdPercent: number }): {
  subject: string;
  text: string;
} {
  return {
    subject: 'Norte: uso de disco acima do limite',
    text: `Uso de disco em ${context.usagePercent.toFixed(1)}%, acima do limite de ${context.thresholdPercent}%.`,
  };
}

export function costBudgetExceededMessage(context: { projectedMonthlyCostUsd: number; budgetUsd: number }): {
  subject: string;
  text: string;
} {
  return {
    subject: 'Norte: projeção de custo de API acima do orçamento',
    text: `Projeção mensal de custo em US$${context.projectedMonthlyCostUsd.toFixed(2)}, acima do orçamento de US$${context.budgetUsd.toFixed(2)}.`,
  };
}

export function cacheRegressionMessage(): { subject: string; text: string } {
  return {
    subject: 'Norte: possível regressão de prompt caching',
    text: 'Chamadas seguidas ao Sonnet sem cache hit (cache_read_input_tokens = 0). Verifique se o system prompt mudou ou parou de ser byte-estável — o custo pode multiplicar 5-10x.',
  };
}
