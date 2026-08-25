import type { Logger } from 'pino';

export interface WebhookProvisionerConfig {
  readonly evolutionApiUrl: string;
  readonly evolutionApiKey: string;
  readonly instance: string;
  /** URL pública do brain dentro da rede Docker (ex.: http://brain:3000/webhook/evolution). */
  readonly webhookUrl: string;
  readonly webhookSecret: string;
}

export interface WebhookProvisionerOptions {
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_BASE_DELAY_MS = 2_000;

/**
 * A Evolution nunca aprende sozinha para onde mandar webhook — alguém tem
 * que chamar webhook/set. Fazemos isso no boot do brain em vez de depender
 * de configuração manual ou de env var do compose (WEBHOOK_GLOBAL_*), que
 * não tem como anexar o segredo de autenticação em nenhum header confiável
 * nesta versão pinada (2.3.7 — issue EvolutionAPI/evolution-api#1933, sem
 * garantia de que `headers` do webhook/set chega às entregas reais).
 *
 * Fallback adotado: o segredo vai na query string da URL do webhook
 * (`?secret=...`) em vez de em header. A rota valida esse valor com
 * comparação de tempo constante, igual ao header (webhook-route.ts).
 *
 * Retry com backoff linear porque no `docker compose up` a Evolution
 * costuma responder ao healthcheck antes de aceitar chamadas de API —
 * falhar rápido aqui derrubaria o boot do brain por uma corrida de start
 * que se resolve sozinha em poucos segundos.
 */
export async function provisionEvolutionWebhook(
  config: WebhookProvisionerConfig,
  logger: Logger,
  options: WebhookProvisionerOptions = {},
): Promise<void> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const url = `${config.evolutionApiUrl}/webhook/set/${config.instance}`;
  const webhookUrlWithSecret = appendSecretQueryParam(config.webhookUrl, config.webhookSecret);

  const body = {
    webhook: {
      enabled: true,
      url: webhookUrlWithSecret,
      webhookByEvents: false,
      webhookBase64: false,
      events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE', 'QRCODE_UPDATED'],
    },
  };

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: config.evolutionApiKey },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(`Evolution respondeu ${response.status} ao provisionar webhook`);
      }

      logger.info({ instance: config.instance, attempt }, 'webhook da Evolution provisionado com sucesso');
      return;
    } catch (err) {
      lastError = err;
      logger.warn(
        { instance: config.instance, attempt, maxAttempts, err },
        'falha ao provisionar webhook da Evolution, tentando novamente',
      );
      if (attempt < maxAttempts) {
        await sleep(baseDelayMs * attempt);
      }
    }
  }

  logger.error(
    { instance: config.instance, maxAttempts, err: lastError },
    'não foi possível provisionar o webhook da Evolution após esgotar as tentativas',
  );
}

function appendSecretQueryParam(webhookUrl: string, secret: string): string {
  const url = new URL(webhookUrl);
  url.searchParams.set('secret', secret);
  return url.toString();
}
