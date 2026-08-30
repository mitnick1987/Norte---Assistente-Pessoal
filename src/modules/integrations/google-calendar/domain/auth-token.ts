/** Único provider desta feature — a coluna já nasce genérica para Gmail/RF-22 reusar a mesma tabela com sua própria linha. */
export const GOOGLE_CALENDAR_PROVIDER = 'google_calendar';

export interface AuthTokenRecord {
  readonly provider: string;
  /** Cifrado em repouso (AES-256-GCM) — nunca texto plano fora do processo (SECURITY.md §4). */
  readonly accessTokenEncrypted: string;
  readonly refreshTokenEncrypted: string;
  /** Vencimento do access token, UTC. */
  readonly expiry: string;
  /** Escopos concedidos de fato — permite detectar downgrade de escopo numa reautorização futura. */
  readonly scopes: string;
  readonly updatedAt: string;
}

export class AuthTokenNotFoundError extends Error {
  constructor(provider: string) {
    super(`nenhum token armazenado para o provider "${provider}" — rode o setup OAuth (GET /setup/google)`);
    this.name = 'AuthTokenNotFoundError';
  }
}
