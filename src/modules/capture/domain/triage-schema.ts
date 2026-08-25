import { z } from 'zod';

/**
 * Output estruturado da triagem Haiku (RF-01): schema é a fonte de verdade
 * do contrato com o modelo — round-trip testado (TESTING.md §1). Ambíguo
 * vira `ambiguous: true` no item (RF-01: "classificação ambígua cai na
 * inbox"), nunca uma pergunta de volta ao usuário.
 */
export const triageItemSchema = z
  .object({
    type: z.enum(['tarefa', 'ideia', 'compromisso', 'lembrete', 'nota']),
    title: z.string().min(1).max(500),
    dueAt: z.string().datetime().optional(),
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
