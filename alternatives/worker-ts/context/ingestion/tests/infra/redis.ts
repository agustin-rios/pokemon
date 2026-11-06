import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import {
  Queue,
  UnrecoverableError,
  WaitingError,
  Worker,
  type ConnectionOptions,
  type Job,
  type WorkerOptions,
} from 'bullmq';
import {
  ExecuteEtlRun,
  type StepExecutor,
} from '../../src/application/use-cases/ExecuteEtlRun.ts';
import type { StepName } from '../../src/index.ts';
import {
  BullMqEtlRunQueue,
  BullMqRunFence,
  BullMqRunProgress,
  ETL_QUEUE,
} from '../../src/infra/adapters/index.ts';

/** Las pruebas de la cola necesitan un Redis real: se saltan si no hay TEST_REDIS_URL. */
export const testRedisUrl = process.env['TEST_REDIS_URL'];

export function connectionOf(url: string): ConnectionOptions {
  const { hostname, port, password } = new URL(url);
  return {
    host: hostname,
    port: Number(port || 6379),
    ...(password ? { password: decodeURIComponent(password) } : {}),
  };
}

export const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Espera a que `check` devuelva algo (no undefined/false) o falla con `what`. */
export async function until<T>(
  what: string,
  check: () => Promise<T | undefined | false> | T | undefined | false,
  timeoutMs = 15_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw new Error(`tiempo agotado: ${what}`);
    await sleep(25);
  }
}

export interface TestQueue {
  readonly url: string;
  /** Prefijo propio de esta prueba: no comparte claves con nadie. */
  readonly prefix: string;
  readonly connection: ConnectionOptions;
  readonly queue: Queue;
  /** Cliente propio para preparar y comprobar claves a mano. */
  readonly redis: Redis;
  readonly adapter: BullMqEtlRunQueue;
  /** Crea un worker de la cola (se cierra solo en `close`). */
  worker(
    processor: (job: Job, token?: string) => Promise<unknown>,
    options?: Partial<WorkerOptions>,
  ): Worker;
  close(): Promise<void>;
}

/** Una cola `etl` con prefijo aislado; `close` cierra los workers y borra todas sus claves. */
export async function createTestQueue(url: string): Promise<TestQueue> {
  const prefix = `test-${process.pid}-${randomUUID()}`;
  const connection = connectionOf(url);
  const queue = new Queue(ETL_QUEUE, { connection, prefix });
  const redis = new Redis(url);
  const workers: Worker[] = [];
  return {
    url,
    prefix,
    connection,
    queue,
    redis,
    adapter: new BullMqEtlRunQueue(queue),
    worker: (processor, options) => {
      const worker = new Worker(ETL_QUEUE, processor, {
        connection,
        prefix,
        concurrency: 1,
        ...options,
      });
      worker.on('error', () => undefined);
      workers.push(worker);
      return worker;
    },
    close: async () => {
      await Promise.all(workers.map((worker) => worker.close(true)));
      await queue.obliterate({ force: true }).catch(() => undefined);
      await queue.close();
      redis.disconnect();
    },
  };
}

const silentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export interface ProcessorOptions {
  readonly stepDeadlineMs?: number;
  readonly shutdownGraceMs?: number;
  readonly lockDurationMs?: number;
  readonly shutdown?: AbortSignal;
}

/**
 * El procesador de un worker: lo mismo que hará el de la app (progreso y cerco de BullMQ
 * sobre ExecuteEtlRun, y el resultado traducido a lo que BullMQ entiende).
 */
export function etlProcessor(
  steps: Readonly<Record<StepName, StepExecutor>>,
  options: ProcessorOptions = {},
) {
  const execute = new ExecuteEtlRun(steps, silentLogger, {
    stepDeadlineMs: options.stepDeadlineMs ?? 60_000,
    shutdownGraceMs: options.shutdownGraceMs ?? 10_000,
  });
  const lockDurationMs = options.lockDurationMs ?? 30_000;

  return async (job: Job, token?: string): Promise<null> => {
    const lockToken = token ?? '';
    const outcome = await execute.execute({
      runId: job.id ?? '',
      progress: new BullMqRunProgress(job),
      fence: new BullMqRunFence(job, lockToken, lockDurationMs),
      ...(options.shutdown ? { shutdown: options.shutdown } : {}),
    });
    if (outcome.status === 'succeeded') return null;
    if (outcome.status === 'failed') {
      if (outcome.errorClass === 'permanent') {
        throw new UnrecoverableError(outcome.message);
      }
      throw new Error(outcome.message, { cause: outcome.cause });
    }
    // Detenida sin terminar: vuelve a la cola sin gastar un intento.
    await job.moveToWait(lockToken);
    throw new WaitingError();
  };
}

/** Los 5 pasos: los que no se indican no hacen nada. */
export function stepsWith(
  overrides: Partial<Record<StepName, StepExecutor['execute']>> = {},
): Record<StepName, StepExecutor> {
  const noop = () => Promise.resolve(null);
  return {
    scrape: { execute: overrides.scrape ?? noop },
    generate: { execute: overrides.generate ?? noop },
    validate: { execute: overrides.validate ?? noop },
    load: { execute: overrides.load ?? noop },
    build_views: { execute: overrides.build_views ?? noop },
  };
}
