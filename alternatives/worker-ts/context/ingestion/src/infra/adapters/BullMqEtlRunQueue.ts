import { randomUUID } from 'node:crypto';
import type { IRedisClient, Job, JobsOptions, Queue } from 'bullmq';
import {
  EnqueueFailedError,
  RunConflictError,
  RunNotFoundError,
} from '../../application/errors.ts';
import type { RunQueue } from '../../application/ports/RunQueue.ts';
import {
  withAllSteps,
  type EtlRun,
  type EtlStep,
  type RunState,
} from '../../domain/index.ts';

/** Nombre de la cola y del trabajo: una corrida es un job `pokemon-etl` de la cola `etl`. */
export const ETL_QUEUE = 'etl';
export const ETL_JOB = 'pokemon-etl';

/** Clave de deduplicación: mientras un job la tenga (en cola, corriendo o esperando un reintento) no entra otro. */
const DEDUPLICATION_ID = 'pokemon-etl';

export const JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 100 },
} as const satisfies JobsOptions;

/** Estados de un job que aún no terminó. */
const ACTIVE_STATES = [
  'active',
  'waiting',
  'delayed',
  'prioritized',
  'waiting-children',
] as const;

const RUN_STATES: Readonly<Record<string, RunState>> = {
  waiting: 'queued',
  delayed: 'queued',
  prioritized: 'queued',
  'waiting-children': 'queued',
  active: 'running',
  completed: 'succeeded',
  failed: 'failed',
};

/** Cuánto vive el candado que ordena los cambios de estado y cuánto se espera para tomarlo. */
const LOCK_TTL_MS = 10_000;
const LOCK_WAIT_MS = 5_000;
const LOCK_RETRY_MS = 25;

/** Scripts Lua del candado (el cliente de BullMQ 6 es una abstracción sin `SET NX` ni `EVAL`). */
const ACQUIRE_LOCK = {
  numberOfKeys: 1,
  lua: `if redis.call('exists', KEYS[1]) == 0 then redis.call('set', KEYS[1], ARGV[1], 'PX', ARGV[2]) return 1 end return 0`,
};
const RELEASE_LOCK = {
  numberOfKeys: 1,
  lua: `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0`,
};

const iso = (timestamp?: number): string | null =>
  timestamp ? new Date(timestamp).toISOString() : null;

/** Los pasos guardados en el progreso del job (que al inicio es el número 0). */
export function stepsOf(progress: unknown): EtlStep[] {
  const steps = (progress as { steps?: unknown } | null)?.steps;
  return Array.isArray(steps) ? (steps as EtlStep[]) : [];
}

/**
 * La cola de corridas sobre BullMQ (Redis es la fuente de verdad de las corridas).
 *
 * - Una sola activa: `deduplication` + concurrencia global 1 de la cola.
 * - `enqueue` y `retry` se ordenan con un candado corto en Redis y buscan antes la corrida
 *   activa. La deduplicación sola no basta: un reintento manual saca del estado `failed`
 *   a un job que no recupera la clave, y un POST nuevo en ese hueco crearía una segunda
 *   corrida. Con el candado, "reintentar" y "POST nuevo" son atómicos entre sí: gana el
 *   que toma el candado primero y el otro ve su efecto (el POST devuelve la corrida
 *   reintentada; el reintento recibe 409 `Ya hay una corrida en curso`).
 */
export class BullMqEtlRunQueue implements RunQueue {
  private readonly queue: Queue;
  private concurrency: Promise<void> | undefined;
  private commands: Promise<IRedisClient> | undefined;

  constructor(queue: Queue) {
    this.queue = queue;
  }

  async enqueue(): Promise<EtlRun> {
    await this.limitConcurrency();
    return this.exclusively(async () => {
      const active = await this.findActive();
      if (active) return this.toRun(active);

      const job = await this.queue.add(
        ETL_JOB,
        {},
        {
          ...JOB_OPTIONS,
          jobId: randomUUID(),
          deduplication: { id: DEDUPLICATION_ID },
        },
      );
      // Si otro productor sin candado se adelantó, `add` devuelve su job, no el nuestro.
      return this.toRun(job);
    });
  }

  async get(runId: string): Promise<EtlRun | null> {
    const job = await this.queue.getJob(runId);
    return job ? this.toRun(job) : null;
  }

  retry(runId: string): Promise<EtlRun> {
    return this.exclusively(async () => {
      const job = await this.queue.getJob(runId);
      if (!job) throw new RunNotFoundError(runId);
      if ((await job.getState()) !== 'failed') {
        throw new RunConflictError(
          'Solo se puede reintentar una corrida fallida',
        );
      }
      if (await this.findActive()) {
        throw new RunConflictError('Ya hay una corrida en curso');
      }

      await job.retry('failed', {
        resetAttemptsMade: true,
        resetAttemptsStarted: true,
      });
      return this.toRun(job);
    });
  }

  /** Concurrencia global 1 en Redis; se fija una vez (y se reintenta si falló). */
  private limitConcurrency(): Promise<void> {
    if (!this.concurrency) {
      this.concurrency = this.queue
        .setGlobalConcurrency(1)
        .then(() => undefined)
        .catch((error: unknown) => {
          this.concurrency = undefined;
          throw error;
        });
    }
    return this.concurrency;
  }

  private async findActive(): Promise<Job | undefined> {
    const [job] = await this.queue.getJobs([...ACTIVE_STATES], 0, 0);
    return job;
  }

  /** El cliente de Redis con los scripts del candado registrados. */
  private redis(): Promise<IRedisClient> {
    this.commands ??= this.queue
      .getBackend()
      .client.then((client) => {
        client.defineCommand('etlLockAcquire', ACQUIRE_LOCK);
        client.defineCommand('etlLockRelease', RELEASE_LOCK);
        return client;
      })
      .catch((error: unknown) => {
        this.commands = undefined;
        throw error;
      });
    return this.commands;
  }

  /** Corre `work` con el candado de la cola; si no lo consigue a tiempo, falla con EnqueueFailedError. */
  private async exclusively<T>(work: () => Promise<T>): Promise<T> {
    const client = await this.redis();
    const key = this.queue.toKey('state-lock');
    const token = randomUUID();
    const deadline = Date.now() + LOCK_WAIT_MS;

    while (
      (await client.runCommand('etlLockAcquire', [key, token, LOCK_TTL_MS])) !==
      1
    ) {
      if (Date.now() >= deadline) throw new EnqueueFailedError();
      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
    }
    try {
      return await work();
    } finally {
      await client.runCommand('etlLockRelease', [key, token]);
    }
  }

  private async toRun(job: Job): Promise<EtlRun> {
    const state = await job.getState();
    return {
      runId: job.id ?? '',
      state: RUN_STATES[state] ?? 'queued',
      queuedAt: iso(job.timestamp) ?? new Date(0).toISOString(),
      startedAt: iso(job.processedOn),
      finishedAt: iso(job.finishedOn),
      // Ejecuciones empezadas (cuenta retomas tras caídas y reintentos con espera).
      attempts: job.attemptsStarted,
      error: job.failedReason || null,
      steps: withAllSteps(stepsOf(job.progress)),
    };
  }
}
