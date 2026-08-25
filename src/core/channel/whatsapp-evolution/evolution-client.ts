import type { Channel } from '../channel.js';
import { SendFailedError } from '../../outbox/sender.js';

export interface EvolutionClientConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly instance: string;
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
   */
  async getBase64FromMediaMessage(messageKey: unknown): Promise<string> {
    const url = `${this.config.baseUrl}/chat/getBase64FromMediaMessage/${this.config.instance}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ message: { key: messageKey } }),
    });

    if (!response.ok) {
      throw new SendFailedError(new Error(`Evolution respondeu ${response.status}`));
    }

    const data = (await response.json()) as { base64?: string };
    if (!data.base64) {
      throw new Error('resposta da Evolution sem campo base64');
    }
    return data.base64;
  }
}
