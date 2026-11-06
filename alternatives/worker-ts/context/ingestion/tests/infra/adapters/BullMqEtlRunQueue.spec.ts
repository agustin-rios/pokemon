import {
  RunConflictError,
  RunNotFoundError,
} from '../../../src/application/errors.ts';
import { PermanentError } from '../../../src/index.ts';
import {
  ETL_JOB,
  JOB_OPTIONS,
} from '../../../src/infra/adapters/BullMqEtlRunQueue.ts';
import {
  createTestQueue,
  etlProcessor,
  stepsWith,
  testRedisUrl,
  until,
  type TestQueue,
} from '../redis.ts';

vi.setConfig({ testTimeout: 30_000 });

const retryable = () => Promise.reject(new Error('conexión rechazada'));
const permanent = () => Promise.reject(new PermanentError('datos inválidos'));

describe.skipIf(!testRedisUrl)('BullMqEtlRunQueue (Redis)', () => {
  let t: TestQueue;

  beforeEach(async () => {
    t = await createTestQueue(testRedisUrl ?? '');
  });
  afterEach(() => t.close());

  /** Un worker cuyo paso `scrape` espera a que se llame `release`. */
  function blockedWorker() {
    let release: () => void = () => undefined;
    const gate = new Promise<null>((resolve) => {
      release = () => resolve(null);
    });
    const worker = t.worker(etlProcessor(stepsWith({ scrape: () => gate })));
    return { worker, release };
  }

  const activeJobs = () =>
    t.queue.getJobs(
      ['active', 'waiting', 'delayed', 'prioritized', 'waiting-children'],
      0,
      -1,
    );

  describe('enqueue', () => {
    it('crea un job pokemon-etl con las opciones de la corrida y la corrida queda en cola', async () => {
      const run = await t.adapter.enqueue();

      expect(run).toMatchObject({
        state: 'queued',
        startedAt: null,
        finishedAt: null,
        attempts: 0,
        error: null,
      });
      expect(run.runId).toMatch(/^[0-9a-f-]{36}$/);
      expect(run.steps.map((step) => step.state)).toEqual(
        Array(5).fill('pending'),
      );
      const job = await t.queue.getJob(run.runId);
      expect(job?.name).toBe(ETL_JOB);
      expect(job?.data).toEqual({});
      expect(job?.opts).toMatchObject({
        attempts: JOB_OPTIONS.attempts,
        backoff: JOB_OPTIONS.backoff,
        removeOnComplete: JOB_OPTIONS.removeOnComplete,
        removeOnFail: JOB_OPTIONS.removeOnFail,
        deduplication: { id: 'pokemon-etl' },
      });
      await expect(t.queue.getGlobalConcurrency()).resolves.toBe(1);
    });

    it('con POST concurrentes se crea un solo job y todos reciben la misma corrida', async () => {
      const runs = await Promise.all(
        Array.from({ length: 12 }, () => t.adapter.enqueue()),
      );

      expect(new Set(runs.map((run) => run.runId)).size).toBe(1);
      expect(await activeJobs()).toHaveLength(1);
    });

    it('con una corrida corriendo devuelve esa misma, y al terminar crea una nueva', async () => {
      const { release } = blockedWorker();
      const first = await t.adapter.enqueue();
      await until('corrida corriendo', async () =>
        (await t.adapter.get(first.runId))?.state === 'running'
          ? true
          : undefined,
      );

      const again = await t.adapter.enqueue();
      expect(again).toMatchObject({ runId: first.runId, state: 'running' });

      release();
      await until('corrida terminada', async () =>
        (await t.adapter.get(first.runId))?.state === 'succeeded'
          ? true
          : undefined,
      );
      const next = await t.adapter.enqueue();
      expect(next.runId).not.toBe(first.runId);
    });

    it('la deduplicación de BullMQ por sí sola también evita dos corridas (productores sin candado)', async () => {
      const first = await t.adapter.enqueue();

      const duplicate = await t.queue.add(
        ETL_JOB,
        {},
        {
          ...JOB_OPTIONS,
          jobId: 'otro-id',
          deduplication: { id: 'pokemon-etl' },
        },
      );

      expect(duplicate.id).toBe(first.runId);
      expect(await activeJobs()).toHaveLength(1);
      await expect(t.queue.getDeduplicationJobId('pokemon-etl')).resolves.toBe(
        first.runId,
      );
    });
  });

  describe('get (mapeo de estados)', () => {
    it('devuelve null si no existe', async () => {
      await expect(
        t.adapter.get('3f2b8a0e-5c1d-4e7a-9b6f-0a1b2c3d4e5f'),
      ).resolves.toBeNull();
    });

    it('en cola -> queued; corriendo -> running con sus pasos; terminada -> succeeded', async () => {
      const queued = await t.adapter.enqueue();
      expect((await t.adapter.get(queued.runId))?.state).toBe('queued');

      let release: () => void = () => undefined;
      const gate = new Promise<null>((resolve) => {
        release = () => resolve(null);
      });
      t.worker(etlProcessor(stepsWith({ generate: () => gate })));

      const running = await until('en generate', async () => {
        const run = await t.adapter.get(queued.runId);
        return run?.steps[1]?.state === 'running' ? run : undefined;
      });
      expect(running).toMatchObject({ state: 'running', attempts: 1 });
      expect(running.startedAt).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/);
      expect(running.finishedAt).toBeNull();
      expect(running.steps.map((step) => step.state)).toEqual([
        'succeeded',
        'running',
        'pending',
        'pending',
        'pending',
      ]);

      release();
      const done = await until('terminada', async () => {
        const run = await t.adapter.get(queued.runId);
        return run?.state === 'succeeded' ? run : undefined;
      });
      expect(done.finishedAt).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/);
      expect(done.error).toBeNull();
      expect(done.steps.every((step) => step.state === 'succeeded')).toBe(true);
    });

    it('un error permanente (UnrecoverableError) deja la corrida failed sin reintentos', async () => {
      const generate = vi.fn(permanent);
      t.worker(etlProcessor(stepsWith({ generate })));

      const run = await t.adapter.enqueue();
      const failed = await until('fallida', async () => {
        const current = await t.adapter.get(run.runId);
        return current?.state === 'failed' ? current : undefined;
      });

      expect(generate).toHaveBeenCalledTimes(1);
      expect(failed).toMatchObject({
        attempts: 1,
        error: 'generate: datos inválidos',
      });
      expect(failed.finishedAt).not.toBeNull();
      expect(failed.steps.map((step) => step.state)).toEqual([
        'succeeded',
        'failed',
        'pending',
        'pending',
        'pending',
      ]);
      expect(failed.steps[1]?.error).toBe('generate: datos inválidos');
    });

    it('un error reintentable queda en cola (delayed) con su error y el backoff exponencial de 5 s', async () => {
      t.worker(etlProcessor(stepsWith({ scrape: retryable })));

      const run = await t.adapter.enqueue();
      const waiting = await until('esperando el reintento', async () => {
        const current = await t.adapter.get(run.runId);
        return current?.error ? current : undefined;
      });

      expect(waiting).toMatchObject({
        state: 'queued',
        attempts: 1,
        error: 'scrape: conexión rechazada',
        finishedAt: null,
      });
      expect(waiting.startedAt).not.toBeNull();
      expect(waiting.steps[0]?.state).toBe('failed');
      const job = await t.queue.getJob(run.runId);
      await expect(job?.getState()).resolves.toBe('delayed');
      const score = Number(
        await t.redis.zscore(t.queue.toKey('delayed'), run.runId),
      );
      const wait = Math.floor(score / 0x1000) - Date.now();
      expect(wait).toBeGreaterThan(3_500);
      expect(wait).toBeLessThanOrEqual(5_000);
    });

    it('reintenta tras el backoff, no repite los pasos exitosos y gasta los 3 intentos', async () => {
      const scrape = vi.fn(() => Promise.resolve(null));
      const generate = vi.fn(retryable);
      t.worker(etlProcessor(stepsWith({ scrape, generate })));
      const run = await t.adapter.enqueue();

      for (const expected of [1, 2]) {
        await until(`intento ${expected} fallido`, async () => {
          const job = await t.queue.getJob(run.runId);
          return job?.attemptsMade === expected &&
            (await job.getState()) === 'delayed'
            ? job
            : undefined;
        });
        await (await t.queue.getJob(run.runId))?.promote();
      }
      const failed = await until('fallida', async () => {
        const current = await t.adapter.get(run.runId);
        return current?.state === 'failed' ? current : undefined;
      });

      expect(scrape).toHaveBeenCalledTimes(1);
      expect(generate).toHaveBeenCalledTimes(3);
      expect(failed).toMatchObject({
        attempts: 3,
        error: 'generate: conexión rechazada',
      });
      expect(failed.steps[0]?.state).toBe('succeeded');
      expect(failed.steps[1]).toMatchObject({ state: 'failed', attempts: 3 });
    });

    it('un apagado entre pasos devuelve la corrida a la cola sin gastar un intento y otro worker la retoma', async () => {
      const shutdown = new AbortController();
      const scrape = vi.fn(() => {
        shutdown.abort();
        return Promise.resolve(null);
      });
      const first = t.worker(
        etlProcessor(stepsWith({ scrape }), { shutdown: shutdown.signal }),
      );
      const run = await t.adapter.enqueue();
      await until('paso scrape listo', async () => {
        const current = await t.adapter.get(run.runId);
        return current?.steps[0]?.state === 'succeeded' ? true : undefined;
      });
      await first.close();

      const stopped = await t.queue.getJob(run.runId);
      await expect(stopped?.getState()).resolves.toBe('waiting');
      expect(stopped?.attemptsMade).toBe(0);

      const generate = vi.fn(() => Promise.resolve(null));
      t.worker(etlProcessor(stepsWith({ scrape, generate })));
      const done = await until('retomada', async () => {
        const current = await t.adapter.get(run.runId);
        return current?.state === 'succeeded' ? current : undefined;
      });

      expect(scrape).toHaveBeenCalledTimes(1);
      expect(generate).toHaveBeenCalledTimes(1);
      // `attempts` cuenta ejecuciones empezadas; el worker detenido puede haber retomado la corrida antes de cerrarse.
      expect(done.attempts).toBeGreaterThanOrEqual(2);
    });
  });

  describe('retry', () => {
    /** Una corrida fallida de forma permanente en `generate`. */
    async function failedRun(generate = vi.fn(permanent)) {
      const worker = t.worker(etlProcessor(stepsWith({ generate })));
      const run = await t.adapter.enqueue();
      await until('fallida', async () =>
        (await t.adapter.get(run.runId))?.state === 'failed' ? true : undefined,
      );
      await worker.close(true);
      return run;
    }

    it('404 si no existe', async () => {
      await expect(
        t.adapter.retry('3f2b8a0e-5c1d-4e7a-9b6f-0a1b2c3d4e5f'),
      ).rejects.toBeInstanceOf(RunNotFoundError);
    });

    it('409 si la corrida no está fallida (en cola o terminada)', async () => {
      const queued = await t.adapter.enqueue();
      await expect(t.adapter.retry(queued.runId)).rejects.toThrow(
        new RunConflictError('Solo se puede reintentar una corrida fallida'),
      );

      t.worker(etlProcessor(stepsWith()));
      await until('terminada', async () =>
        (await t.adapter.get(queued.runId))?.state === 'succeeded'
          ? true
          : undefined,
      );
      await expect(t.adapter.retry(queued.runId)).rejects.toThrow(
        'Solo se puede reintentar una corrida fallida',
      );
    });

    it('409 si ya hay otra corrida activa', async () => {
      const failed = await failedRun();
      const other = await t.adapter.enqueue();

      await expect(t.adapter.retry(failed.runId)).rejects.toThrow(
        new RunConflictError('Ya hay una corrida en curso'),
      );
      expect((await t.adapter.get(failed.runId))?.state).toBe('failed');
      expect((await t.adapter.get(other.runId))?.state).toBe('queued');
    });

    it('202: reencola la misma corrida con los intentos a cero y retoma desde el paso fallido', async () => {
      const scrape = vi.fn(() => Promise.resolve(null));
      const failing = vi.fn(permanent);
      const worker = t.worker(
        etlProcessor(stepsWith({ scrape, generate: failing })),
      );
      const run = await t.adapter.enqueue();
      await until('fallida', async () =>
        (await t.adapter.get(run.runId))?.state === 'failed' ? true : undefined,
      );
      await worker.close(true);

      const retried = await t.adapter.retry(run.runId);

      expect(retried).toMatchObject({
        runId: run.runId,
        state: 'queued',
        attempts: 0,
        finishedAt: null,
      });
      expect(retried.steps[1]?.state).toBe('failed');

      const generate = vi.fn(() => Promise.resolve(null));
      t.worker(etlProcessor(stepsWith({ scrape, generate })));
      const done = await until('terminada', async () => {
        const current = await t.adapter.get(run.runId);
        return current?.state === 'succeeded' ? current : undefined;
      });

      expect(scrape).toHaveBeenCalledTimes(1);
      expect(generate).toHaveBeenCalledTimes(1);
      expect(done).toMatchObject({ attempts: 1, error: null });
      expect(done.steps[1]).toMatchObject({ state: 'succeeded', attempts: 2 });
    });

    it('dos reintentos a la vez: uno gana (202) y el otro recibe 409', async () => {
      const failed = await failedRun();

      const results = await Promise.allSettled([
        t.adapter.retry(failed.runId),
        t.adapter.retry(failed.runId),
      ]);

      expect(results.map((r) => r.status).sort()).toEqual([
        'fulfilled',
        'rejected',
      ]);
      expect(await activeJobs()).toHaveLength(1);
    });

    /**
     * Carrera "reintento vs POST nuevo". Garantía: `enqueue` y `retry` se ordenan con un
     * candado y cada uno mira antes si hay una corrida activa, así que nunca quedan dos
     * activas a la vez. Gane quien gane:
     *  - el reintento gana: el POST devuelve la corrida reintentada (mismo runId);
     *  - el POST gana: crea la nueva y el reintento recibe 409 `Ya hay una corrida en curso`.
     */
    it('reintento vs POST nuevo: nunca quedan dos corridas activas', async () => {
      const outcomes = new Set<string>();

      for (let i = 0; i < 12; i++) {
        const failed = await failedRun();
        const calls =
          i % 2 === 0
            ? [t.adapter.retry(failed.runId), t.adapter.enqueue()]
            : [t.adapter.enqueue(), t.adapter.retry(failed.runId)];
        const [a, b] = await Promise.allSettled(calls);
        const [retry, post] = i % 2 === 0 ? [a, b] : [b, a];

        expect(post?.status).toBe('fulfilled');
        const active = await activeJobs();
        expect(active).toHaveLength(1);
        if (retry?.status === 'fulfilled') {
          outcomes.add('retry');
          expect(
            (post as PromiseFulfilledResult<{ runId: string }>).value.runId,
          ).toBe(failed.runId);
        } else {
          outcomes.add('post');
          expect((retry as PromiseRejectedResult).reason).toBeInstanceOf(
            RunConflictError,
          );
          expect(active[0]?.id).not.toBe(failed.runId);
        }
        await active[0]?.remove();
        await (await t.queue.getJob(failed.runId))?.remove();
      }
      expect(outcomes.size).toBeGreaterThanOrEqual(1);
    });
  });
});
