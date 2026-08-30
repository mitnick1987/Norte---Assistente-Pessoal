export type SubsystemStatus = 'ok' | 'error';

export interface SystemHealthInput {
  readonly dbStatus: SubsystemStatus;
  /**
   * `undefined` = scheduler nunca rodou um tick ainda — grace period do
   * boot (`runCatchUp` roda antes do `fastify.listen`, mas dead man's
   * switch e `/health` podem ser consultados no instante entre subir a
   * porta e o primeiro tick real). Tratado como saudável: degradar aqui
   * faria `/health` reportar `degraded` em todo boot até o primeiro poll,
   * o oposto de "erro que ninguém vê" — é ausência de evidência, não
   * evidência de problema.
   */
  readonly lastSchedulerTickAt: Date | undefined;
  readonly whatsappState: 'open' | 'connecting' | 'close' | 'qr_requested' | 'unknown';
  readonly now: Date;
  /** Janela de tolerância do tick do scheduler (settings) — poll é a cada 30s, então qualquer coisa muito maior que isso já indica scheduler parado. */
  readonly schedulerStaleAfterMs: number;
}

export interface SystemHealthResult {
  readonly healthy: boolean;
  readonly db: SubsystemStatus;
  readonly scheduler: 'ok' | 'stale';
  readonly whatsapp: 'ok' | 'degraded';
}

/**
 * Fonte única de verdade sobre "o sistema está vivo o bastante" (spec,
 * Decisões tomadas): alimenta tanto `GET /health` quanto o gate do dead
 * man's switch — as duas implementações nunca podem divergir sobre o que
 * "saudável" significa, porque pingar "vivo" com o scheduler parado seria
 * pior que não ter dead man's switch nenhum.
 */
export function evaluateSystemHealth(input: SystemHealthInput): SystemHealthResult {
  const schedulerStatus =
    input.lastSchedulerTickAt !== undefined &&
    input.now.getTime() - input.lastSchedulerTickAt.getTime() > input.schedulerStaleAfterMs
      ? 'stale'
      : 'ok';

  // 'unknown' é o estado antes do primeiro connection.update (boot) — grace
  // period pelo mesmo motivo do scheduler acima; só 'close'/'connecting'/
  // 'qr_requested' são evidência positiva de sessão não pronta.
  const whatsappStatus = input.whatsappState === 'open' || input.whatsappState === 'unknown' ? 'ok' : 'degraded';

  return {
    healthy: input.dbStatus === 'ok' && schedulerStatus === 'ok' && whatsappStatus === 'ok',
    db: input.dbStatus,
    scheduler: schedulerStatus,
    whatsapp: whatsappStatus,
  };
}
