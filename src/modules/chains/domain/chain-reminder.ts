export type ChainStageType = 'vespera' | 'manha' | 'preparo';

/**
 * Entrada de `expandChain`: só os campos do evento que o cálculo precisa —
 * o domínio não conhece `EventRecord` inteiro (id, gcalId etc.) para não
 * acoplar a função pura ao schema de `tasks` (ARCHITECTURE.md §4: entrada
 * evento + settings, saída lista de reminders).
 */
export interface ChainSourceEvent {
  readonly eventId: number;
  readonly itemId: number;
  readonly title: string;
  /** Instante UTC do compromisso. */
  readonly startAt: Date;
  readonly deslocamentoMin: number;
}

export interface ChainSettings {
  /** Hora (0-23, America/Sao_Paulo) do alerta de véspera, na noite anterior ao compromisso. */
  readonly vesperaHour: number;
  /** Hora (0-23, America/Sao_Paulo) do alerta de manhã, no próprio dia do compromisso. */
  readonly manhaHour: number;
  /** Minutos de margem de preparo somados ao deslocamento — "hora de sair" = startAt − deslocamento − margem. */
  readonly prepMarginMin: number;
}

export interface ChainReminder {
  readonly tipoCadeia: ChainStageType;
  readonly fireAt: Date;
  readonly eventId: number;
  readonly itemId: number;
  readonly title: string;
  readonly startAt: Date;
  readonly deslocamentoMin: number;
}
