/**
 * Amostra de resposta a uma proativa (spec item 5): dia da semana (0 =
 * domingo) + hora cheia em America/Sao_Paulo — granularidade grosseira de
 * propósito, é o suficiente para "sábado de manhã" e não precisa de mais
 * para o M3 ainda não construído (RF-24 é quem vai pedir mais métrica).
 */
export interface ResponseSample {
  readonly weekday: number;
  readonly hour: number;
}

/**
 * Horário mais frequente das últimas N amostras (spec item 5: "lê o horário
 * mais frequente das últimas N respostas") — empate resolvido pela amostra
 * mais recente entre as empatadas, nunca aleatório.
 */
export function selectMostFrequentWindow(samples: readonly ResponseSample[]): ResponseSample | undefined {
  if (samples.length === 0) return undefined;

  const counts = new Map<string, { sample: ResponseSample; count: number; lastIndex: number }>();
  samples.forEach((sample, index) => {
    const key = `${sample.weekday}-${sample.hour}`;
    const existing = counts.get(key);
    if (existing) {
      existing.count += 1;
      existing.lastIndex = index;
    } else {
      counts.set(key, { sample, count: 1, lastIndex: index });
    }
  });

  return [...counts.values()].sort((a, b) => b.count - a.count || b.lastIndex - a.lastIndex)[0]!.sample;
}

const WEEKDAY_LABELS_PT = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'] as const;

function periodLabel(hour: number): string {
  if (hour < 12) return 'de manhã';
  if (hour < 18) return 'à tarde';
  return 'à noite';
}

/**
 * Formulação da proposta em texto natural ("sábado de manhã, 9h") — nunca a
 * pergunta "para quando?" (spec item 1). `hour` vira o horário concreto da
 * proposta: o período (manhã/tarde/noite) é só a formulação, a hora exata
 * usada no cálculo da data é a mesma do padrão observado.
 */
export function formatWindowLabel(window: ResponseSample): string {
  const weekday = WEEKDAY_LABELS_PT[window.weekday];
  return `${weekday} ${periodLabel(window.hour)}, ${window.hour}h`;
}
