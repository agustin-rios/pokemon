import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { Job } from 'bullmq';
import { FenceLostError } from '../../../src/index.ts';
import { BullMqRunFence } from '../../../src/infra/adapters/BullMqRunFence.ts';
import { BullMqRunProgress } from '../../../src/infra/adapters/BullMqRunProgress.ts';
import { PrismaStagingStore } from '../../../src/infra/adapters/PrismaStagingStore.ts';
import { referenceRows } from '../../fixtures.ts';
import { stageReference } from '../helpers.ts';
import {
  createTestQueue,
  etlProcessor,
  stepsWith,
  testRedisUrl,
  until,
  type TestQueue,
} from '../redis.ts';
import { createTestDb, testDatabaseUrl, type TestDb } from '../testDb.ts';
import { step } from '../../stubs.ts';

vi.setConfig({ testTimeout: 30_000 });

const LOCK_DURATION_MS = 30_000;

describe.skipIf(!testRedisUrl)(
  'BullMqRunProgress y BullMqRunFence (Redis)',
  () => {
    let t: TestQueue;

    beforeEach(async () => {
      t = await createTestQueue(testRedisUrl ?? '');
    });
    afterEach(() => t.close());

    /** Corre `work` dentro de un worker real: recibe el job activo y su token de lock. */
    function insideWorker<T>(work: (job: Job, token: string) => Promise<T>) {
      return new Promise<T>((resolve, reject) => {
        t.worker(async (job, token) => {
          try {
            resolve(await work(job, token ?? ''));
          } catch (error) {
            reject(error);
          }
          return null;
        });
        void t.adapter.enqueue().catch(reject);
      });
    }

    describe('BullMqRunProgress', () => {
      it('al inicio no hay pasos, y lo guardado queda en Redis para la siguiente ejecución', async () => {
        const saved = [step('scrape', 'succeeded', { output: { pokemon: 3 } })];

        const runId = await insideWorker(async (job) => {
          const progress = new BullMqRunProgress(job);
          expect(await progress.load()).toEqual([]);
          await progress.save(saved);
          expect(await progress.load()).toEqual(saved);
          return job.id ?? '';
        });

        const reloaded = await t.queue.getJob(runId);
        expect(await new BullMqRunProgress(reloaded as Job).load()).toEqual(
          saved,
        );
        expect((await t.adapter.get(runId))?.steps[0]).toMatchObject({
          state: 'succeeded',
          output: { pokemon: 3 },
        });
      });
    });

    describe('BullMqRunFence', () => {
      const lockKey = (job: Job) => `${t.queue.toKey(job.id ?? '')}:lock`;

      it('no falla mientras el lock sea de la ejecución, y lo renueva', async () => {
        await insideWorker(async (job, token) => {
          const fence = new BullMqRunFence(job, token, LOCK_DURATION_MS);

          await t.redis.pexpire(lockKey(job), 2_000);
          await expect(fence.assertOwned()).resolves.toBeUndefined();

          expect(await t.redis.pttl(lockKey(job))).toBeGreaterThan(20_000);
        });
      });

      it('falla con FenceLostError si el lock es de otra ejecución', async () => {
        await insideWorker(async (job, token) => {
          await t.redis.set(lockKey(job), randomUUID(), 'PX', LOCK_DURATION_MS);

          await expect(
            new BullMqRunFence(job, token, LOCK_DURATION_MS).assertOwned(),
          ).rejects.toBeInstanceOf(FenceLostError);
          // No le quita el lock a su dueña.
          expect(await t.redis.exists(lockKey(job))).toBe(1);
        });
      });

      it('falla con FenceLostError si el lock venció', async () => {
        await insideWorker(async (job, token) => {
          await t.redis.del(lockKey(job));

          await expect(
            new BullMqRunFence(job, token, LOCK_DURATION_MS).assertOwned(),
          ).rejects.toBeInstanceOf(FenceLostError);
          // Y no lo recrea: la ejecución no recupera una corrida que perdió.
          expect(await t.redis.exists(lockKey(job))).toBe(0);
        });
      });

      describe.skipIf(!testDatabaseUrl)('con staging en Postgres', () => {
        let db: TestDb;
        let store: PrismaStagingStore;

        beforeAll(async () => {
          db = await createTestDb(testDatabaseUrl ?? '');
          store = new PrismaStagingStore(db.prisma, db.stagingSchema);
          await stageReference(store);
        });
        afterAll(() => db?.drop());

        const pokemonCount = async () =>
          (
            await db.sql.query(
              `SELECT count(*)::int AS n FROM "${db.stagingSchema}".pokemon`,
            )
          ).rows[0].n as number;

        it('con el lock perdido la escritura de staging se revierte; con el lock propio se confirma', async () => {
          const rows = referenceRows();
          const smaller = {
            types: rows.types,
            pokemon: rows.pokemon.slice(0, 10),
            pokemonTypes: rows.pokemon_types.slice(0, 5),
          } as never;
          const before = await pokemonCount();
          expect(before).toBe(100);

          await insideWorker(async (job, token) => {
            const signal = new AbortController().signal;
            const fence = new BullMqRunFence(job, token, LOCK_DURATION_MS);

            await t.redis.set(
              lockKey(job),
              randomUUID(),
              'PX',
              LOCK_DURATION_MS,
            );
            await expect(
              store.replaceScraped(smaller, { signal, fence }),
            ).rejects.toBeInstanceOf(FenceLostError);
            expect(await pokemonCount()).toBe(100);

            await t.redis.set(lockKey(job), token, 'PX', LOCK_DURATION_MS);
            await store.replaceScraped(smaller, { signal, fence });
            expect(await pokemonCount()).toBe(10);
          });
        });
      });
    });
  },
);

describe.skipIf(!testRedisUrl)(
  'recuperación de una corrida cuyo worker murió (Redis)',
  () => {
    let t: TestQueue;
    let child: ChildProcess | undefined;

    beforeEach(async () => {
      t = await createTestQueue(testRedisUrl ?? '');
    });
    afterEach(async () => {
      child?.kill('SIGKILL');
      await t.close();
    });

    it('un worker en otro proceso muerto con SIGKILL en mitad de un paso: otro worker retoma sin repetir lo exitoso', async () => {
      const lockDuration = 1_000;
      const script = fileURLToPath(
        new URL('../stalledWorker.ts', import.meta.url),
      );
      child = spawn(process.execPath, [script], {
        env: {
          ...process.env,
          REDIS_URL: t.url,
          QUEUE_PREFIX: t.prefix,
          LOCK_DURATION_MS: String(lockDuration),
        },
        stdio: ['ignore', 'pipe', 'inherit'],
      });
      await new Promise<void>((resolve, reject) => {
        child?.stdout?.once('data', () => resolve());
        child?.once('exit', (code) =>
          reject(new Error(`el worker hijo salió (${code})`)),
        );
      });

      const run = await t.adapter.enqueue();
      await until('el hijo está en generate', async () => {
        const current = await t.adapter.get(run.runId);
        return current?.state === 'running' &&
          current.steps[1]?.state === 'running'
          ? true
          : undefined;
      });
      child.kill('SIGKILL');
      await new Promise((resolve) => child?.once('exit', resolve));
      // Sigue "corriendo" para BullMQ: nadie lo marcó, solo se vencerá su lock.
      expect((await t.adapter.get(run.runId))?.state).toBe('running');

      const scrape = vi.fn(() => Promise.resolve(null));
      const generate = vi.fn(() => Promise.resolve({ trainers: 1 }));
      t.worker(
        etlProcessor(stepsWith({ scrape, generate }), {
          lockDurationMs: lockDuration,
        }),
        {
          lockDuration,
          stalledInterval: 500,
        },
      );

      const done = await until('retomada por el otro worker', async () => {
        const current = await t.adapter.get(run.runId);
        return current?.state === 'succeeded' ? current : undefined;
      });

      expect(scrape).not.toHaveBeenCalled();
      expect(generate).toHaveBeenCalledTimes(1);
      expect(done.attempts).toBe(2);
      expect(done.steps[0]).toMatchObject({ state: 'succeeded', attempts: 1 });
      expect(done.steps[1]).toMatchObject({
        state: 'succeeded',
        attempts: 2,
        output: { trainers: 1 },
      });
    });
  },
);
