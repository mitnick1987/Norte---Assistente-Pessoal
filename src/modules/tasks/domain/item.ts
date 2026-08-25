export type ItemType = 'tarefa' | 'ideia' | 'compromisso' | 'lembrete' | 'nota';

export type ItemOrigin = 'texto' | 'audio' | 'foto' | 'encaminhada' | 'email' | 'trabalho';

export type ItemStatus = 'inbox' | 'ativa' | 'em_andamento' | 'feita' | 'adiada' | 'arquivada' | 'dropada';

export type ItemPriority = 1 | 2 | 3;

/**
 * Linha crua do domínio, incluindo `snoozeCount` — quem lê daqui é só o
 * serviço/repository internos do módulo. O contrato público (public/) expõe
 * um tipo separado sem esse campo, então omiti-lo do payload de saída é
 * garantido pelo compilador, não por lembrar de filtrar na hora de montar a
 * resposta (RF-11, testado em tools.test.ts).
 */
export interface ItemRecord {
  readonly id: number;
  readonly type: ItemType;
  readonly title: string;
  readonly origin: ItemOrigin;
  readonly status: ItemStatus;
  readonly priority: ItemPriority | null;
  readonly dueAt: string | null;
  readonly snoozeCount: number;
  readonly sourceMessageId: number | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export class InvalidStatusTransitionError extends Error {
  constructor(from: ItemStatus, to: ItemStatus) {
    super(`transição de status inválida: "${from}" -> "${to}"`);
    this.name = 'InvalidStatusTransitionError';
  }
}

/**
 * Estados terminais lógicos (ADR-009): uma vez feito/arquivado/dropado, o
 * item só volta a circular por uma reativação explícita, não por acidente de
 * uma tool genérica de update. Nesta feature nenhuma tool reativa — reabrir
 * fica para quando um RF concreto pedir (ex.: hygiene revertendo proposta).
 */
const TRANSITIONS: Record<ItemStatus, readonly ItemStatus[]> = {
  inbox: ['ativa', 'em_andamento', 'feita', 'adiada', 'arquivada', 'dropada'],
  ativa: ['em_andamento', 'feita', 'adiada', 'arquivada', 'dropada'],
  em_andamento: ['feita', 'adiada', 'arquivada', 'dropada'],
  adiada: ['ativa', 'em_andamento', 'feita', 'arquivada', 'dropada'],
  feita: [],
  arquivada: [],
  dropada: [],
};

export function canTransition(from: ItemStatus, to: ItemStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: ItemStatus, to: ItemStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidStatusTransitionError(from, to);
  }
}
