import type { Database } from 'better-sqlite3';
import type { AuthTokenRecord } from './domain/index.js';

interface AuthTokenRow {
  provider: string;
  access_token_encrypted: string;
  refresh_token_encrypted: string;
  expiry: string;
  scopes: string;
  updated_at: string;
}

function toRecord(row: AuthTokenRow): AuthTokenRecord {
  return {
    provider: row.provider,
    accessTokenEncrypted: row.access_token_encrypted,
    refreshTokenEncrypted: row.refresh_token_encrypted,
    expiry: row.expiry,
    scopes: row.scopes,
    updatedAt: row.updated_at,
  };
}

export interface UpsertAuthTokenInput {
  readonly provider: string;
  readonly accessTokenEncrypted: string;
  readonly refreshTokenEncrypted: string;
  readonly expiry: Date;
  readonly scopes: string;
}

/**
 * Única porta de leitura/escrita de `auth_tokens` (ARCHITECTURE.md §2) —
 * mesmo padrão de `EventsRepository`: nenhum outro módulo faz SQL direto
 * nesta tabela.
 */
export class AuthTokensRepository {
  constructor(private readonly db: Database) {}

  findByProvider(provider: string): AuthTokenRecord | undefined {
    const row = this.db
      .prepare<[string], AuthTokenRow>('SELECT * FROM auth_tokens WHERE provider = ?')
      .get(provider);
    return row ? toRecord(row) : undefined;
  }

  /**
   * Setup inicial e refresh usam o mesmo upsert: a troca de `refresh_token`
   * só acontece na primeira autorização (Google só reemite com
   * `prompt=consent`), então uma reautorização sem `refresh_token` novo
   * preserva o anterior — nunca sobrescreve com vazio.
   */
  upsert(input: UpsertAuthTokenInput): AuthTokenRecord {
    this.db
      .prepare(
        `INSERT INTO auth_tokens (provider, access_token_encrypted, refresh_token_encrypted, expiry, scopes, updated_at)
         VALUES (@provider, @accessTokenEncrypted, @refreshTokenEncrypted, @expiry, @scopes, datetime('now'))
         ON CONFLICT(provider) DO UPDATE SET
           access_token_encrypted = excluded.access_token_encrypted,
           refresh_token_encrypted = excluded.refresh_token_encrypted,
           expiry = excluded.expiry,
           scopes = excluded.scopes,
           updated_at = excluded.updated_at`,
      )
      .run({
        provider: input.provider,
        accessTokenEncrypted: input.accessTokenEncrypted,
        refreshTokenEncrypted: input.refreshTokenEncrypted,
        expiry: input.expiry.toISOString(),
        scopes: input.scopes,
      });

    const record = this.findByProvider(input.provider);
    if (!record) throw new Error(`auth_tokens: falha ao ler de volta o provider "${input.provider}" logo após upsert`);
    return record;
  }

  /** Atualiza só o access token após refresh — preserva o refresh_token e os scopes já concedidos. */
  updateAccessToken(provider: string, accessTokenEncrypted: string, expiry: Date): void {
    this.db
      .prepare(
        `UPDATE auth_tokens SET access_token_encrypted = ?, expiry = ?, updated_at = datetime('now') WHERE provider = ?`,
      )
      .run(accessTokenEncrypted, expiry.toISOString(), provider);
  }
}
