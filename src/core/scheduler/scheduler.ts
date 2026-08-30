import type { Logger } from 'pino';
import type { JobHandler } from '../kernel/types.js';
import { selectDueJobs, nextOccurrence, type DueJobCandidate } from './domain/index.js';
import { parseRecurrence, type JobRepository, type JobRow } from './job-repository.js';

const POLL_INTERVAL_MS = 30_000;

function toCandidate(row: JobRow): DueJobCandidate {
  return {
    id: row.id,
    nextRunAt: new Date(row.next_run_at),
    status: row.status,
    deliveredAt: row.delivered_at ? new Date(row.delivered_at) : null,
  };
}

export interface SchedulerDeps {
  readonly repository: JobRepository;
  readonly jobHandlers: ReadonlyMap<string, JobHandler>;
  readonly logger: Logger;
  /** Injetável para teste — nunca Date.now() direto no domínio (TESTING.md §7). */
  now?: () => Date;
}

/**
 * Poll de 30s + catch-up no boot (mesmo caminho: ambos só selecionam jobs
 * `pending` vencidos). Nenhum timer por job — um único intervalo global,
 * exatamente o desenho que o ADR-004 exige.
 */
export class Scheduler {
  private timer: NodeJS.Timeout | undefined;
  private readonly now: () => Date;
  private lastTickAt: Date | undefined;

  constructor(private readonly deps: SchedulerDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  /** Consumido pelo GET /health — reflete que o poll segue vivo, não só que o processo está de pé. */
  getLastTickAt(): Date | undefined {
    return this.lastTickAt;
  }

  async tick(): Promise<void> {
    const candidates = this.deps.repository.findPending().map(toCandidate);
    const due = selectDueJobs(candidates, this.now());

    for (const job of due) {
      await this.runJob(job.id);
    }

    this.lastTickAt = this.now();
  }

  private async runJob(jobId: number): Promise<void> {
    const row = this.deps.repository.findById(jobId);
    if (!row) return;

    const handler = this.deps.jobHandlers.get(row.type);
    if (!handler) {
      this.deps.logger.warn({ jobId, type: row.type }, 'job sem handler registrado');
      return;
    }

    this.deps.repository.markRunning(jobId);

    try {
      await handler({ jobId, payload: JSON.parse(row.payload) });

      const recurrence = parseRecurrence(row.recurrence);
      if (recurrence) {
        const next = nextOccurrence(this.now(), recurrence);
        this.deps.repository.rescheduleRecurring(jobId, next);
      }
    } catch (err) {
      this.deps.repository.incrementAttempts(jobId);
      this.deps.logger.error({ jobId, err }, 'falha ao executar job');
      throw err;
    }
  }

  /** Chamado no boot: mesmo tick, mas o log deixa explícito que é catch-up pós-restart. */
  async runCatchUp(): Promise<void> {
    this.deps.logger.info('catch-up de jobs vencidos no boot');
    await this.tick();
  }

  start(): void {
    this.timer = setInterval(() => {
      this.tick().catch((err: unknown) => {
        this.deps.logger.error({ err }, 'falha no tick do scheduler');
      });
    }, POLL_INTERVAL_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
