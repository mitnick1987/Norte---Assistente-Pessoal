import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { runMigrations } from '../../src/core/db/migrator.js';
import { coreMigrations } from '../../src/core/db/migrations/index.js';
import { SettingsStore } from '../../src/core/settings/store.js';

function buildStore(): SettingsStore {
  const db = new Database(':memory:');
  runMigrations(db, coreMigrations);
  return new SettingsStore(db);
}

describe('SettingsStore', () => {
  it('semeia defaults ausentes sem sobrescrever valor já existente', () => {
    const store = buildStore();

    store.set('briefing_hour', '07:00');
    store.seedDefaults({ briefing_hour: '08:00', daily_cap: 6 });

    expect(store.get('briefing_hour')).toBe('07:00');
    expect(store.get('daily_cap')).toBe(6);
  });

  it('retorna undefined para chave inexistente', () => {
    const store = buildStore();
    expect(store.get('inexistente')).toBeUndefined();
  });

  it('set sobrescreve valor de chave já existente', () => {
    const store = buildStore();
    store.set('daily_cap', 6);
    store.set('daily_cap', 10);
    expect(store.get('daily_cap')).toBe(10);
  });

  it('preserva o tipo do valor (boolean, número, string) via round-trip JSON', () => {
    const store = buildStore();
    store.set('flag', true);
    store.set('count', 42);
    store.set('label', 'texto');

    expect(store.get('flag')).toBe(true);
    expect(store.get('count')).toBe(42);
    expect(store.get('label')).toBe('texto');
  });
});
