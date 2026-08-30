import { z } from 'zod';

/**
 * Contrato mínimo do webhook da Evolution que a fundação precisa validar.
 * Objetos sem `.passthrough()` rejeitam campo desconhecido (preferimos
 * recusar formato inesperado a aceitar em silêncio); `audioMessage` é
 * exceção deliberada — o protobuf real traz campos que não usamos.
 */
const messageKeySchema = z.object({
  remoteJid: z.string().min(1),
  id: z.string().min(1).optional(),
  fromMe: z.boolean().optional(),
});

/**
 * Campos do protobuf `AudioMessage` do WhatsApp relevantes ao STT (FEAT-003):
 * `mimetype` decide o content-type enviado ao provider; `seconds` é usado
 * para o limite de duração (settings) antes de qualquer chamada de STT.
 * `.passthrough()` porque o payload real traz mais campos (mediaKey, url,
 * fileSha256...) que não usamos — rejeitar por causa deles seria frágil a
 * mudança de versão da Evolution sem ganho de segurança real.
 */
const audioMessageSchema = z
  .object({
    mimetype: z.string().min(1).optional(),
    seconds: z.number().nonnegative().optional(),
    fileLength: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();

const messageContentSchema = z.object({
  conversation: z.string().optional(),
  extendedTextMessage: z.object({ text: z.string() }).optional(),
  audioMessage: audioMessageSchema.optional(),
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
