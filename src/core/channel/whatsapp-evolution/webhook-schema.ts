import { z } from 'zod';

/**
 * Contrato mínimo do webhook da Evolution que a fundação precisa validar.
 * Deliberadamente permissivo em campos que não usamos ainda (`.passthrough`
 * nos objetos internos não é usado — preferimos rejeitar o que não
 * reconhecemos a aceitar formato inesperado em silêncio).
 */
const messageKeySchema = z.object({
  remoteJid: z.string().min(1),
  id: z.string().min(1).optional(),
  fromMe: z.boolean().optional(),
});

const messageContentSchema = z.object({
  conversation: z.string().optional(),
  extendedTextMessage: z.object({ text: z.string() }).optional(),
  audioMessage: z.object({}).passthrough().optional(),
  imageMessage: z.object({}).passthrough().optional(),
});

const messageUpsertDataSchema = z.object({
  key: messageKeySchema,
  message: messageContentSchema.optional(),
  pushName: z.string().optional(),
});

export const messagesUpsertEventSchema = z.object({
  event: z.literal('messages.upsert'),
  instance: z.string().min(1),
  data: messageUpsertDataSchema,
});

export const connectionUpdateEventSchema = z.object({
  event: z.literal('connection.update'),
  instance: z.string().min(1),
  data: z.object({
    state: z.string(),
  }),
});

export const evolutionWebhookSchema = z.discriminatedUnion('event', [
  messagesUpsertEventSchema,
  connectionUpdateEventSchema,
]);

export type EvolutionWebhookPayload = z.infer<typeof evolutionWebhookSchema>;
export type MessagesUpsertEvent = z.infer<typeof messagesUpsertEventSchema>;
export type ConnectionUpdateEvent = z.infer<typeof connectionUpdateEventSchema>;
