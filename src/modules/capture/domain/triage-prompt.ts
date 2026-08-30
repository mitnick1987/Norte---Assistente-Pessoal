import { toZonedParts } from '../../../core/scheduler/domain/timezone.js';

/**
 * Prompt da triagem (Haiku 4.5, ADR-007): curto de propósito — sem os
 * fragmentos multi-módulo que justificariam prompt caching elaborado (fora
 * de escopo desta feature, ver FEAT-002 "Fora de escopo"). A proibição de
 * pergunta de estrutura é a regra mais importante daqui: é o que RF-01
 * verifica por teste adversarial, não só por instrução de texto.
 *
 * A data/hora atual de São Paulo é injetada só como cinto de segurança para
 * o modelo classificar "hoje"/"amanhã" com mais contexto — a RESOLUÇÃO da
 * expressão relativa em data absoluta é sempre do backend
 * (`parseRelativeDatePtBr`, ADR-006), nunca confiada ao LLM: o Haiku não tem
 * como calcular "sexta 14h" em UTC sem alucinar ano/dia.
 */
const WEEKDAY_NAMES_PT = [
  'domingo',
  'segunda-feira',
  'terça-feira',
  'quarta-feira',
  'quinta-feira',
  'sexta-feira',
  'sábado',
] as const;

function formatCurrentDateTime(now: Date): string {
  const parts = toZonedParts(now);
  const referenceUtc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  const weekday = WEEKDAY_NAMES_PT[referenceUtc.getUTCDay()];
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${weekday}, ${pad(parts.day)}/${pad(parts.month)}/${parts.year} ${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function buildTriageSystemPrompt(now: Date): string {
  return `Você classifica mensagens recebidas pelo WhatsApp de um único usuário (o dono do sistema).

Data e hora atuais (fuso America/Sao_Paulo): ${formatCurrentDateTime(now)}. Use isso só para entender expressões como "hoje"/"amanhã" — não calcule datas absolutas.

Classifique a mensagem em exatamente uma categoria:
- "captura": o usuário está anotando algo (tarefa, ideia, compromisso, lembrete ou nota) — inclusive mensagens encaminhadas.
- "comando": uma instrução curta sobre um item já existente (ex.: "feito", "adia sexta", "dropa", "lista").
- "conversa": qualquer outra coisa (pergunta, comentário, conversa livre).

Se for "captura", extraia cada item mencionado com: type (tarefa|ideia|compromisso|lembrete|nota), title (curto, no que a pessoa disse) e dueExpression (a expressão de data/hora EXATAMENTE como o usuário disse, ex.: "sexta 14h", "amanhã", "dia 30 às 9h" — nunca calcule ou converta a data você mesmo, só se uma data/hora explícita ou claramente relativa foi mencionada).

REGRA ABSOLUTA: nunca pergunte projeto, prazo, categoria ou tag. Se a classificação do tipo, prioridade ou data estiver ambígua, marque o item com "ambiguous": true e siga em frente — nunca devolva uma pergunta pedindo para o usuário especificar estrutura. A resposta é sempre a classificação JSON, nunca uma pergunta em texto livre.

Responda chamando a tool "submit_triage" com o resultado. Não escreva texto fora da tool call.`;
}
