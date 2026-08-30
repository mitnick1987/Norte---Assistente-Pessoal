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
  // 0.0.0.0 por padrão: dentro do container o isolamento de borda já vem do
  // Compose (só publica 127.0.0.1 no host, SECURITY.md §5) — bind em loopback
  // aqui dentro deixaria o webhook da Evolution, que chega por eth0, inalcançável.
  HOST: z.string().min(1).default('0.0.0.0'),

  DB_PATH: z.string().min(1),
  TZ: z.string().default('America/Sao_Paulo'),

  EVOLUTION_API_URL: z.string().url(),
  EVOLUTION_API_KEY: z.string().min(1),
  EVOLUTION_INSTANCE: z.string().min(1),
  EVOLUTION_WEBHOOK_SECRET: z.string().min(16),
  // URL pela qual a Evolution alcança o brain dentro da rede Docker interna
  // (nome do serviço no compose, não localhost) — usada só para o brain se
  // autoprovisionar no webhook/set da Evolution no boot (SECURITY.md §5).
  BRAIN_WEBHOOK_URL: z.string().url().default('http://brain:3000/webhook/evolution'),

  OWNER_WHATSAPP_JID: z.string().min(1),

  DAILY_PROACTIVE_CAP: z.coerce.number().int().positive().default(6),

  SMTP_URL: z.string().optional(),
  ALERT_EMAIL: z.string().email().optional(),

  // Área sensível (FEAT-002, SECURITY.md): chave de API em texto, nunca em
  // log — redigida no logger (core/logger.ts) mesmo em debug.
  ANTHROPIC_API_KEY: z.string().min(1),
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
