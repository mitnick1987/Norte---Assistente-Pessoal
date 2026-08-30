import type { ModuleManifest } from '../../core/kernel/types.js';
import type { JobRepository } from '../../core/scheduler/index.js';
import type { SettingsStore } from '../../core/settings/index.js';
import { ITEM_DROPPED_EVENT, ITEM_RESCHEDULED_EVENT, type EventService } from '../tasks/public/index.js';
import { ChainService } from './chain-service.js';
import type { ChainSettings } from './domain/index.js';

/**
 * Antecedências e deslocamento default (FEAT-004, item 2 do escopo): chaves
 * novas em `settings`, nunca hard-coded no módulo — o dono ajusta sem
 * precisar de deploy.
 */
export const CHAINS_VESPERA_HOUR_SETTING = 'chains.vesperaHour';
const CHAINS_VESPERA_HOUR_DEFAULT = 20;

export const CHAINS_MANHA_HOUR_SETTING = 'chains.manhaHour';
const CHAINS_MANHA_HOUR_DEFAULT = 8;

export const CHAINS_PREP_MARGIN_MIN_SETTING = 'chains.prepMarginMin';
const CHAINS_PREP_MARGIN_MIN_DEFAULT = 15;

/** Default de `deslocamento_min` do evento no momento da criação (spec, item 1) — ajustável por evento depois, não usado no recálculo da cadeia. */
export const CHAINS_DESLOCAMENTO_MIN_DEFAULT_SETTING = 'chains.deslocamentoMinDefault';
export const CHAINS_DESLOCAMENTO_MIN_DEFAULT_DEFAULT = 30;

export interface BuildChainsModuleDeps {
  /** Construído por `buildTasksModule` — `chains` reage a `events` só pelo contrato público de `tasks` (Decisões tomadas da FEAT-004), nunca com repository próprio. */
  readonly eventService: EventService;
  readonly jobRepository: JobRepository;
  readonly settings: SettingsStore;
  /** Injetável para teste — nunca `new Date()` direto no cálculo da cadeia (TESTING.md §7). */
  readonly now?: () => Date;
}

function readChainSettings(settings: SettingsStore): ChainSettings {
  return {
    vesperaHour: Number(settings.get<number>(CHAINS_VESPERA_HOUR_SETTING) ?? CHAINS_VESPERA_HOUR_DEFAULT),
    manhaHour: Number(settings.get<number>(CHAINS_MANHA_HOUR_SETTING) ?? CHAINS_MANHA_HOUR_DEFAULT),
    prepMarginMin: Number(settings.get<number>(CHAINS_PREP_MARGIN_MIN_SETTING) ?? CHAINS_PREP_MARGIN_MIN_DEFAULT),
  };
}

/**
 * `chains` não tem migração própria — reage a `events`/`items` (tasks) só
 * via o contrato público, e grava jobs só via `core/scheduler`
 * (ARCHITECTURE.md §2). Settings são lidas a cada chamada (não uma vez no
 * boot) para o dono poder ajustar antecedência sem reiniciar o processo.
 *
 * Assina `item.dropped`/`item.rescheduled` no bus (ADR-011): é assim que
 * "chains reage a mudança de item" acontece sem `tasks` conhecer `chains`.
 */
export function buildChainsModule(deps: BuildChainsModuleDeps): { manifest: ModuleManifest; service: ChainService } {
  const service = new ChainService({
    eventService: deps.eventService,
    jobRepository: deps.jobRepository,
    getSettings: () => readChainSettings(deps.settings),
    ...(deps.now ? { now: deps.now } : {}),
  });

  const manifest: ModuleManifest = {
    name: 'chains',
    events: {
      [ITEM_DROPPED_EVENT]: (payload) => service.onItemDropped(payload),
      [ITEM_RESCHEDULED_EVENT]: (payload) => service.onItemRescheduled(payload),
    },
    settingsDefaults: {
      [CHAINS_VESPERA_HOUR_SETTING]: CHAINS_VESPERA_HOUR_DEFAULT,
      [CHAINS_MANHA_HOUR_SETTING]: CHAINS_MANHA_HOUR_DEFAULT,
      [CHAINS_PREP_MARGIN_MIN_SETTING]: CHAINS_PREP_MARGIN_MIN_DEFAULT,
      [CHAINS_DESLOCAMENTO_MIN_DEFAULT_SETTING]: CHAINS_DESLOCAMENTO_MIN_DEFAULT_DEFAULT,
    },
  };

  return { manifest, service };
}
