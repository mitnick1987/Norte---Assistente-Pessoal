import type { Channel } from '../channel.js';
import { SendFailedError } from '../../outbox/sender.js';

export interface EvolutionClientConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly instance: string;
}

/**
 * Mídia expirada/indisponível na Evolution (spec FEAT-003, item 4) é um
 * erro diferente de falha de rede/instabilidade: a varredura de recuperação
 * precisa saber que não adianta tentar de novo (marca `processed`, não
 * `failed`) — distinguir isso de qualquer outra `SendFailedError` exige um
 * tipo próprio em vez de inspecionar mensagem de erro.
 */
export class MediaUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('mídia indisponível ou expirada na Evolution');
    this.name = 'MediaUnavailableError';
    this.cause = cause;
  }
}

/**
 * Adapter fino sobre a API HTTP da Evolution. Confirmação de envio no
 * outbox depende só do 2xx daqui — nenhuma lógica de retry/delay mora
 * neste client, isso é responsabilidade do outbox (core/outbox).
 */
export class EvolutionClient implements Channel {
  readonly name = 'whatsapp-evolution';

  constructor(private readonly config: EvolutionClientConfig) {}

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      apikey: this.config.apiKey,
    };
  }

  async sendText(jid: string, body: string): Promise<void> {
    const url = `${this.config.baseUrl}/message/sendText/${this.config.instance}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ number: jid, text: body }),
    });

    if (!response.ok) {
      throw new SendFailedError(new Error(`Evolution respondeu ${response.status}`));
    }
  }

  async sendPresence(jid: string): Promise<void> {
    const url = `${this.config.baseUrl}/chat/sendPresence/${this.config.instance}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ number: jid, presence: 'composing' }),
    });

    if (!response.ok) {
      throw new SendFailedError(new Error(`Evolution respondeu ${response.status}`));
    }
  }

  /**
   * Busca ativa da mídia — nunca o base64 que eventualmente venha no
   * payload do webhook (SECURITY.md §6: payload é sempre não confiável,
   * mesmo vindo da própria Evolution autenticada).
   *
   * Qualquer falha aqui (HTTP não-ok, corpo sem `base64`) vira
   * `MediaUnavailableError` — do ponto de vista de quem chama (varredura de
   * recuperação, spec item 4), a distinção relevante não é a causa técnica,
   * é "esta mídia específica não pode ser obtida", ponto em que a mídia
   * expirada na Evolution é o caso dominante.
   */
  async getBase64FromMediaMessage(messageKey: unknown): Promise<string> {
    const url = `${this.config.baseUrl}/chat/getBase64FromMediaMessage/${this.config.instance}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ message: { key: messageKey } }),
    });

    if (!response.ok) {
      throw new MediaUnavailableError(new Error(`Evolution respondeu ${response.status}`));
    }

    let data: { base64?: string };
    try {
      data = (await response.json()) as { base64?: string };
    } catch (err) {
      throw new MediaUnavailableError(err);
    }

    if (!data.base64) {
      throw new MediaUnavailableError(new Error('resposta da Evolution sem campo base64'));
    }
    return data.base64;
  }
}
