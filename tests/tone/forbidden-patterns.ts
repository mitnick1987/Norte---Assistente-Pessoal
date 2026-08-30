/**
 * Padrões proibidos de tom (TESTING.md §4.1, RF-14): compartilhado por
 * todos os testes de regressão de tom desta feature — cobrança, higiene e
 * revisão (features futuras) devem reusar a mesma lista quando chegarem,
 * não reinventar um novo conjunto de proibições por módulo.
 */
export const FORBIDDEN_TONE_PATTERNS: readonly RegExp[] = [
  /adiamentos?_count/i,
  /\d+\s*(ª|a)\s*vez que voc[eê]/i,
  /voc[eê] n[aã]o fez/i,
  /de novo/i,
  /hist[oó]rico de falhas?/i,
  /parab[eé]ns.*campe[aã]o/i,
];

export function assertToneIsSafe(message: string): void {
  for (const pattern of FORBIDDEN_TONE_PATTERNS) {
    if (pattern.test(message)) {
      throw new Error(`mensagem viola padrão de tom proibido (${pattern}): "${message}"`);
    }
  }
}
