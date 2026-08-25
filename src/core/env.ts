import { z } from 'zod';

/**
 * Secrets só entram por variável de ambiente, validados uma vez no boot —
 * falha rápido e claro em vez de undefined se propagando até um erro
 * obscuro em produção (SECURITY.md §4). Campos opcionais nesta fundação
 * (Google, Litestream, Healthchecks) porque os RFs que os exigem ainda não
 * chegaram; a rota crítica desta entrega só precisa da Evolution + owner.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  DB_PATH: z.string().min(1),
  TZ: z.string().default('America/Sao_Paulo'),

  EVOLUTION_API_URL: z.string().url(),
  EVOLUTION_API_KEY: z.string().min(1),
  EVOLUTION_INSTANCE: z.string().min(1),
  EVOLUTION_WEBHOOK_SECRET: z.string().min(16),

  OWNER_WHATSAPP_JID: z.string().min(1),

  DAILY_PROACTIVE_CAP: z.coerce.number().int().positive().default(6),

  SMTP_URL: z.string().optional(),
  ALERT_EMAIL: z.string().email().optional(),
});

export type Env = z.infer<typeof envSchema>;

export class InvalidEnvError extends Error {
  constructor(issues: string) {
    super(`variáveis de ambiente inválidas:\n${issues}`);
    this.name = 'InvalidEnvError';
  }
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `- ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new InvalidEnvError(issues);
  }
  return result.data;
}
