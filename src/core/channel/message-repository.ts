import type { Database } from 'better-sqlite3';

/**
 * Envelope persistido em `message_key_json` para mensagens de áudio
 * (FEAT-003): a varredura de recuperação precisa dos dois campos para
 * refazer a busca de mídia + STT depois de um restart — `messageKey` para
 * `getBase64FromMediaMessage`, `mimeType` para a chamada ao provider de STT.
 */
export interface AudioRecoveryData {
  readonly messageKey: unknown;
  readonly mimeType: string;
}

export interface RecordInboundInput {
  jid: string;
  waMessageId: string | undefined;
  body: string | undefined;
  /** FEAT-003: presente só para mensagens de áudio — sinaliza à varredura de recuperação que precisa buscar mídia de novo, não só reler `body`. */
  mediaType?: 'audio';
  audioRecoveryData?: AudioRecoveryData;
}

export interface RecordLlmUsageInput {
  jid: string;
  intent: string;
  tokensIn: number;
  tokensOut: number;
  cacheReadTokens: number;
}

export type RecordInboundResult = { readonly isNew: true; readonly messageId: number } | { readonly isNew: false };

export interface PendingMessageRow {
  readonly id: number;
  readonly jid: string;
  readonly body: string | null;
  readonly createdAt: string;
  readonly mediaType: 'audio' | null;
  /** `undefined` quando a mensagem não é de áudio ou o dado de recuperação nunca foi gravado (payload degradado). */
  readonly audioRecoveryData: AudioRecoveryData | undefined;
}

/**
 * Dedup por `wa_message_id` via índice único parcial (migração 001): a
 * inserção falha com SQLITE_CONSTRAINT quando a Evolution reentrega o
 * mesmo webhook, e é isso que usamos para decidir "já processamos".
 *
 * O índice é parcial (`WHERE wa_message_id IS NOT NULL`) — SQLite nunca
 * colide dois NULLs, então uma entrada sem id furaria o dedup em silêncio.
 * A rota já rejeita isso antes de chegar aqui (fail-closed no webhook), mas
 * o repository também recusa como segunda barreira: nenhum chamador
 * consegue gravar uma mensagem indeduplicável por essa via.
 */
export class MessageRepository {
  constructor(private readonly db: Database) {}

  /**
   * Grava a mensagem de entrada já como `pending` (ADR-018) — é a mesma
   * escrita que antes só resolvia dedup, sem escrita adicional. Retorna o id
   * para o chamador disparar o processamento em background e para o vínculo
   * `source_message_id` em `items`.
   *
   * `audioRecoveryData` (FEAT-003) só é gravado para `mediaType: 'audio'` —
   * é o que a varredura de recuperação usa para buscar a mídia de novo via
   * `getBase64FromMediaMessage` e repetir o STT depois de um restart;
   * mensagem de texto não precisa dele porque `body` já é o conteúdo completo.
   */
  tryRecordInbound(input: RecordInboundInput): RecordInboundResult {
    if (!input.waMessageId) return { isNew: false };

    try {
      const result = this.db
        .prepare(
          `INSERT INTO messages (direction, wa_message_id, jid, body, processing_status, media_type, message_key_json)
           VALUES ('in', ?, ?, ?, 'pending', ?, ?)`,
        )
        .run(
          input.waMessageId,
          input.jid,
          input.body ?? null,
          input.mediaType ?? null,
          input.audioRecoveryData ? JSON.stringify(input.audioRecoveryData) : null,
        );
      return { isNew: true, messageId: Number(result.lastInsertRowid) };
    } catch (err) {
      if (isUniqueConstraintError(err)) return { isNew: false };
      throw err;
    }
  }

  /**
   * Grava a transcrição antes de seguir para a triagem (spec item 2) — fica
   * registrada mesmo que uma etapa posterior falhe, para depuração e para a
   * varredura de recuperação distinguir "já transcrito, faltou triagem" de
   * "nunca chegou a transcrever".
   */
  recordTranscription(messageId: number, transcricao: string): void {
    this.db.prepare(`UPDATE messages SET transcricao = ? WHERE id = ?`).run(transcricao, messageId);
  }

  recordOutbound(jid: string, body: string): void {
    this.db.prepare(`INSERT INTO messages (direction, jid, body) VALUES ('out', ?, ?)`).run(jid, body);
  }

  /**
   * Base do monitor de custo (RF-15): uma linha por chamada ao LLM, sem
   * `wa_message_id` (não é webhook, não participa do dedup) — `intent`
   * carrega o papel da chamada (ex.: "triagem") para o relatório mensal
   * futuro distinguir triagem de conversa.
   */
  recordLlmUsage(input: RecordLlmUsageInput): void {
    this.db
      .prepare(
        `INSERT INTO messages (direction, jid, intent, tokens_in, tokens_out, cache_read_tokens)
         VALUES ('in', ?, ?, ?, ?, ?)`,
      )
      .run(input.jid, input.intent, input.tokensIn, input.tokensOut, input.cacheReadTokens);
  }

  markProcessed(messageId: number): void {
    this.db.prepare(`UPDATE messages SET processing_status = 'processed' WHERE id = ?`).run(messageId);
  }

  markFailed(messageId: number): void {
    this.db.prepare(`UPDATE messages SET processing_status = 'failed' WHERE id = ?`).run(messageId);
  }

  /**
   * Candidatas à varredura de recuperação no boot (ADR-018): todas as
   * mensagens de entrada ainda `pending`, sem filtro de idade aqui — o corte
   * pelo limiar é feito em JS (mesmo padrão do scheduler, due-jobs.ts) para
   * não depender de comparação de string de data em SQL (created_at usa
   * `datetime('now')`, formato diferente de `Date#toISOString()`).
   */
  /**
   * Janela de conversa recente do brain (FEAT-006, spec item 4): só texto
   * final de cada turno (`body IS NOT NULL` exclui as linhas que
   * `recordLlmUsage` grava para o monitor de custo, que não são turno de
   * conversa nenhum). Ordena por mais recente para aplicar o `limit` e
   * inverte depois — é o jeito barato de pegar "os N últimos" sem varrer a
   * tabela inteira em bancos que cresçam grandes.
   */
  findRecentConversation(jid: string, limit: number): { direction: 'in' | 'out'; body: string }[] {
    const rows = this.db
      .prepare<
        [string, number],
        { direction: 'in' | 'out'; body: string }
      >(
        `SELECT direction, body FROM messages
         WHERE jid = ? AND body IS NOT NULL
         ORDER BY id DESC LIMIT ?`,
      )
      .all(jid, limit);
    return rows.reverse();
  }

  findPendingInbound(): PendingMessageRow[] {
    return this.db
      .prepare<
        [],
        { id: number; jid: string; body: string | null; created_at: string; media_type: 'audio' | null; message_key_json: string | null }
      >(
        `SELECT id, jid, body, created_at, media_type, message_key_json FROM messages
         WHERE direction = 'in' AND processing_status = 'pending'
         ORDER BY created_at ASC`,
      )
      .all()
      .map((row) => ({
        id: row.id,
        jid: row.jid,
        body: row.body,
        createdAt: row.created_at,
        mediaType: row.media_type,
        audioRecoveryData: parseAudioRecoveryData(row.message_key_json),
      }));
  }
}

function isUniqueConstraintError(err: unknown): boolean {
  return err instanceof Error && err.message.includes('UNIQUE constraint failed');
}

/** Payload malformado nunca derruba a varredura de recuperação (SECURITY.md §6) — trata como dado ausente. */
function parseAudioRecoveryData(json: string | null): AudioRecoveryData | undefined {
  if (!json) return undefined;
  try {
    const parsed = JSON.parse(json) as Partial<AudioRecoveryData>;
    if (typeof parsed.mimeType !== 'string' || !('messageKey' in parsed)) return undefined;
    return { messageKey: parsed.messageKey, mimeType: parsed.mimeType };
  } catch {
    return undefined;
  }
}
