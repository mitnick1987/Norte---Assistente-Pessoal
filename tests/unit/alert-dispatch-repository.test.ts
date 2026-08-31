import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/core/db/migrator.js';
import { infraOpsMigrations } from '../../src/infra-ops/migrations/index.js';
import { AlertDispatchRepository } from '../../src/infra-ops/alert-dispatch-repository.js';

const WINDOW_MS = 30 * 60_000;

function buildRepository(): AlertDispatchRepository {
  const db = new Database(':memory:');
  runMigrations(db, infraOpsMigrations);
  return new AlertDispatchRepository(db);
}

describe('AlertDispatchRepository.tryClaim', () => {
  it('reivindica o slot quando a chave nunca foi vista (primeiro disparo)', () => {
    const repository = buildRepository();
    const now = new Date('2026-08-30T12:00:00.000Z');

    expect(repository.tryClaim('session_down', now, WINDOW_MS)).toBe(true);
    expect(repository.findLastSentAt('session_down')?.toISOString()).toBe(now.toISOString());
  });

  it('nega o slot dentro da janela do último claim', () => {
    const repository = buildRepository();
    const first = new Date('2026-08-30T12:00:00.000Z');
    const second = new Date(first.getTime() + 60_000); // 1 min depois, dentro da janela de 30 min

    expect(repository.tryClaim('session_down', first, WINDOW_MS)).toBe(true);
    expect(repository.tryClaim('session_down', second, WINDOW_MS)).toBe(false);
    // nega o slot sem alterar o timestamp gravado (a janela continua contando do 1º claim)
    expect(repository.findLastSentAt('session_down')?.toISOString()).toBe(first.toISOString());
  });

  it('reivindica de novo depois que a janela expira', () => {
    const repository = buildRepository();
    const first = new Date('2026-08-30T12:00:00.000Z');
    const afterWindow = new Date(first.getTime() + WINDOW_MS + 1_000);

    expect(repository.tryClaim('session_down', first, WINDOW_MS)).toBe(true);
    expect(repository.tryClaim('session_down', afterWindow, WINDOW_MS)).toBe(true);
    expect(repository.findLastSentAt('session_down')?.toISOString()).toBe(afterWindow.toISOString());
  });

  it('chaves lógicas diferentes reivindicam independentemente (mesma regra do anti-flood por chave)', () => {
    const repository = buildRepository();
    const now = new Date('2026-08-30T12:00:00.000Z');

    expect(repository.tryClaim('session_down', now, WINDOW_MS)).toBe(true);
    expect(repository.tryClaim('disk_usage', now, WINDOW_MS)).toBe(true);
  });

  /**
   * Achado de review FEAT-008: o par antigo findLastSentAt→(envia)→recordSent
   * era check-then-act — sem `await` no meio, duas chamadas "concorrentes"
   * (mesmo evento de microtask) liam o mesmo estado "fora da janela" antes
   * de qualquer uma gravar. `tryClaim` fecha isso: grava antes de decidir
   * enviar, então só uma das duas Promises concorrentes recebe `true`.
   */
  it('duas reivindicações concorrentes da mesma chave — só uma reivindica (sem corrida)', () => {
    const repository = buildRepository();
    const now = new Date('2026-08-30T12:00:00.000Z');

    const results = [
      repository.tryClaim('session_down', now, WINDOW_MS),
      repository.tryClaim('session_down', now, WINDOW_MS),
    ];

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it('duas reivindicações concorrentes via Promise.all (dispatch assíncrono real) — só um envio', async () => {
    const repository = buildRepository();
    const now = new Date('2026-08-30T12:00:00.000Z');

    const claims = await Promise.all([
      Promise.resolve().then(() => repository.tryClaim('session_down', now, WINDOW_MS)),
      Promise.resolve().then(() => repository.tryClaim('session_down', now, WINDOW_MS)),
    ]);

    expect(claims.filter(Boolean)).toHaveLength(1);
  });
});
