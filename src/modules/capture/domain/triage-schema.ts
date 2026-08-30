import { z } from 'zod';

/**
 * Output estruturado da triagem Haiku (RF-01): schema é a fonte de verdade
 * do contrato com o modelo — round-trip testado (TESTING.md §1). Ambíguo
 * vira `ambiguous: true` no item (RF-01: "classificação ambígua cai na
 * inbox"), nunca uma pergunta de volta ao usuário.
 *
 * `dueExpression` (ADR-006): o Haiku nunca calcula data absoluta — ele não
 * tem como saber o dia de hoje nem o fuso sem alucinar. O modelo devolve a
 * expressão relativa como o usuário disse ("sexta 14h", "amanhã"), e é o
 * backend quem resolve em UTC via `parseRelativeDatePtBr`, com `now`
 * injetado e TZ America/Sao_Paulo explícito.
 */
export const triageItemSchema = z
  .object({
    type: z.enum(['tarefa', 'ideia', 'compromisso', 'lembrete', 'nota']),
    title: z.string().min(1).max(500),
    dueExpression: z.string().min(1).max(200).optional(),
    ambiguous: z.boolean().optional(),
  })
  .strict();

export type TriageItem = z.infer<typeof triageItemSchema>;

export const triageOutputSchema = z
  .object({
    classification: z.enum(['captura', 'comando', 'conversa']),
    items: z.array(triageItemSchema).default([]),
  })
  .strict();

export type TriageOutput = z.infer<typeof triageOutputSchema>;
