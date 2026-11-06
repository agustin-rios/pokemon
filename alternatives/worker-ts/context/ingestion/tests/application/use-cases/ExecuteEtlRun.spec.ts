import { setTimeout as sleep } from 'node:timers/promises';
import { AttemptsExhaustedError, HttpStatusError } from '@pokemon/pokemon-data';
import {
  ExecuteEtlRun,
  type RunExecution,
  type StepExecutor,
} from '../../../src/application/use-cases/ExecuteEtlRun.ts';
import type { StepContext } from '../../../src/application/ports/StepContext.ts';
import {
  DataValidationError,
  FenceLostError,
  STEPS,
  StepDeadlineError,
  type StepName,
} from '../../../src/index.ts';
import { memoryProgress, ownedFence, step, stubLogger } from '../../stubs.ts';

const OPTIONS = { stepDeadlineMs: 1_000, shutdownGraceMs: 1_000 };

/** Pasos falsos que anotan el orden en que corren; `behaviors` cambia el de alguno. */
function steps(
  behaviors: Partial<Record<StepName, StepExecutor['execute']>> = {},
) {
  const calls: StepName[] = [];
  const contexts: StepContext[] = [];
  const executors = Object.fromEntries(
    STEPS.map((name) => [
      name,
      {
        execute: (context: StepContext) => {
          calls.push(name);
          contexts.push(context);
          return behaviors[name]?.(context) ?? Promise.resolve({ ran: name });
        },
      },
    ]),
  ) as Record<StepName, StepExecutor>;
  return { executors, calls, contexts };
}

/** Un paso que no termina hasta que se aborta su señal; entonces falla tras `settleMs`. */
const untilAborted =
  (settleMs = 0): StepExecutor['execute'] =>
  async ({ signal }) => {
    await new Promise<void>((resolve) =>
      signal.addEventListener('abort', () => resolve(), { once: true }),
    );
    await sleep(settleMs);
    throw signal.reason;
  };

function setup(
  behaviors: Partial<Record<StepName, StepExecutor['execute']>> = {},
  initial = memoryProgress(),
  options = OPTIONS,
) {
  const logger = stubLogger();
  const s = steps(behaviors);
  const processor = new ExecuteEtlRun(s.executors, logger, options);
  const execution = (extra: Partial<RunExecution> = {}): RunExecution => ({
    runId: 'run-1',
    progress: initial.progress,
    fence: ownedFence(),
    ...extra,
  });
  return { processor, execution, logger, progress: initial, ...s };
}

const states = (progress: ReturnType<typeof memoryProgress>) =>
  Object.fromEntries(progress.current().map((s) => [s.name, s.state]));

describe('ExecuteEtlRun', () => {
  describe('ejecución normal y retoma', () => {
    it('corre los 5 pasos en orden y guarda el progreso en cada transición', async () => {
      const t = setup();

      await expect(t.processor.execute(t.execution())).resolves.toEqual({
        status: 'succeeded',
      });

      expect(t.calls).toEqual([...STEPS]);
      // Por paso: running y succeeded.
      expect(t.progress.saves).toHaveLength(10);
      expect(t.progress.current().map((s) => s.state)).toEqual(
        STEPS.map(() => 'succeeded'),
      );
      expect(t.progress.current()[0]).toMatchObject({
        name: 'scrape',
        attempts: 1,
        error: null,
        output: { ran: 'scrape' },
      });
      expect(t.progress.current()[0]?.startedAt).toEqual(expect.any(String));
      expect(t.progress.current()[0]?.finishedAt).toEqual(expect.any(String));
      expect(t.progress.saves[0]?.[0]).toMatchObject({ state: 'running' });
    });

    it('el output undefined se guarda como null', async () => {
      const t = setup({ build_views: () => Promise.resolve(undefined) });

      await t.processor.execute(t.execution());

      expect(t.progress.current()[4]?.output).toBeNull();
    });

    it('retoma: no repite los pasos exitosos y conserva sus datos', async () => {
      const t = setup(
        {},
        memoryProgress([
          step('scrape', 'succeeded', { output: { pokemon: 100 } }),
          step('generate', 'succeeded'),
          step('validate', 'failed', { error: 'validate: x', attempts: 1 }),
        ]),
      );

      await expect(t.processor.execute(t.execution())).resolves.toEqual({
        status: 'succeeded',
      });

      expect(t.calls).toEqual(['validate', 'load', 'build_views']);
      const [scrape, , validate] = t.progress.current();
      expect(scrape).toMatchObject({ attempts: 1, output: { pokemon: 100 } });
      // El paso que falló se cuenta como un intento más y limpia su error.
      expect(validate).toMatchObject({
        state: 'succeeded',
        attempts: 2,
        error: null,
      });
    });

    it('un paso que quedó running por una ejecución caída se vuelve a ejecutar', async () => {
      const t = setup(
        {},
        memoryProgress([
          step('scrape', 'succeeded'),
          step('generate', 'running'),
        ]),
      );

      await t.processor.execute(t.execution());

      expect(t.calls[0]).toBe('generate');
      expect(t.progress.current()[1]?.attempts).toBe(2);
    });

    it('con todo ya exitoso no ejecuta nada', async () => {
      const t = setup(
        {},
        memoryProgress(STEPS.map((name) => step(name, 'succeeded'))),
      );

      await expect(t.processor.execute(t.execution())).resolves.toEqual({
        status: 'succeeded',
      });
      expect(t.calls).toEqual([]);
    });

    it('cada paso recibe una señal propia sin abortar y el cerco de la ejecución', async () => {
      const t = setup();
      const execution = t.execution();

      await t.processor.execute(execution);

      expect(t.contexts).toHaveLength(5);
      for (const context of t.contexts) {
        expect(context.signal.aborted).toBe(false);
        expect(context.fence).toBe(execution.fence);
      }
      expect(new Set(t.contexts.map((c) => c.signal)).size).toBe(5);
    });
  });

  describe('fallos clasificados', () => {
    it('un fallo permanente: la corrida falla, no sigue y deja el motivo en el paso', async () => {
      const t = setup({
        validate: () =>
          Promise.reject(
            new DataValidationError(['pokemon id 3: height debe ser > 0']),
          ),
      });

      const outcome = await t.processor.execute(t.execution());

      expect(outcome).toMatchObject({
        status: 'failed',
        step: 'validate',
        errorClass: 'permanent',
        message:
          'validate: 1 problema(s) en los datos:\n- pokemon id 3: height debe ser > 0',
      });
      expect(t.calls).toEqual(['scrape', 'generate', 'validate']);
      expect(states(t.progress)).toEqual({
        scrape: 'succeeded',
        generate: 'succeeded',
        validate: 'failed',
        load: 'pending',
        build_views: 'pending',
      });
      expect(t.progress.current()[2]).toMatchObject({
        error:
          'validate: 1 problema(s) en los datos:\n- pokemon id 3: height debe ser > 0',
        finishedAt: expect.any(String),
      });
      expect(t.logger.error).toHaveBeenCalledWith(
        expect.stringContaining('permanente'),
      );
    });

    it('un HTTP 404 es permanente y un 503 agotado es reintentable, con su causa raíz', async () => {
      const url = 'https://x/pokemon/9';
      const permanent = setup({
        scrape: () => Promise.reject(new HttpStatusError(url, 404)),
      });
      expect(
        await permanent.processor.execute(permanent.execution()),
      ).toMatchObject({
        errorClass: 'permanent',
        message: `scrape: GET ${url} respondió HTTP 404`,
      });

      const retryable = setup({
        scrape: () =>
          Promise.reject(
            new AttemptsExhaustedError(url, 4, new HttpStatusError(url, 503)),
          ),
      });
      expect(
        await retryable.processor.execute(retryable.execution()),
      ).toMatchObject({
        status: 'failed',
        errorClass: 'retryable',
        message:
          `scrape: GET ${url} falló tras 4 intentos\n` +
          `causa: GET ${url} respondió HTTP 503`,
      });
    });

    it('el error original viaja en el resultado', async () => {
      const boom = new Error('boom');
      const t = setup({ load: () => Promise.reject(boom) });

      const outcome = await t.processor.execute(t.execution());

      expect(outcome).toMatchObject({ status: 'failed', cause: boom });
    });

    it('si guardar el progreso falla, el error se propaga (no es un fallo del paso)', async () => {
      const t = setup();
      const failing = {
        ...t.execution(),
        progress: {
          load: () => Promise.resolve([]),
          save: () => Promise.reject(new Error('redis caído')),
        },
      };

      await expect(t.processor.execute(failing)).rejects.toThrow('redis caído');
      expect(t.calls).toEqual([]);
    });
  });

  describe('cerco', () => {
    it('si el paso pierde el cerco, la ejecución se detiene sin marcarlo como fallido', async () => {
      const t = setup({ load: () => Promise.reject(new FenceLostError()) });

      await expect(t.processor.execute(t.execution())).resolves.toEqual({
        status: 'stopped',
        reason: 'fence',
      });
      expect(t.calls).toEqual(['scrape', 'generate', 'validate', 'load']);
      expect(t.progress.current()[3]?.state).toBe('running');
    });
  });

  describe('apagado: drenar y abandonar', () => {
    it('termina el paso en curso y no empieza el siguiente', async () => {
      const shutdown = new AbortController();
      const t = setup({
        generate: async () => {
          shutdown.abort(); // llega SIGTERM en pleno paso
          await sleep(20);
          return { trainers: 1 };
        },
      });

      await expect(
        t.processor.execute(t.execution({ shutdown: shutdown.signal })),
      ).resolves.toEqual({ status: 'stopped', reason: 'drained' });

      expect(t.calls).toEqual(['scrape', 'generate']);
      expect(states(t.progress)).toMatchObject({
        scrape: 'succeeded',
        generate: 'succeeded',
        validate: 'pending',
      });
      expect(t.progress.current()[1]?.output).toEqual({ trainers: 1 });
    });

    it('con el apagado ya pedido no empieza ningún paso', async () => {
      const t = setup();

      await expect(
        t.processor.execute(t.execution({ shutdown: AbortSignal.abort() })),
      ).resolves.toEqual({ status: 'stopped', reason: 'drained' });
      expect(t.calls).toEqual([]);
    });

    it('si el paso tarda más que la gracia se cancela, y se espera a que de verdad termine', async () => {
      const shutdown = new AbortController();
      let settledAt = 0;
      const t = setup(
        {
          load: async (context) => {
            setTimeout(() => shutdown.abort(), 5);
            try {
              await untilAborted(60)(context);
            } finally {
              settledAt = performance.now();
            }
          },
        },
        memoryProgress(),
        { stepDeadlineMs: 5_000, shutdownGraceMs: 30 },
      );

      const outcome = await t.processor.execute(
        t.execution({ shutdown: shutdown.signal }),
      );
      const returnedAt = performance.now();

      expect(outcome).toEqual({ status: 'stopped', reason: 'abandoned' });
      // No devuelve el control mientras el paso abandonado sigue vivo.
      expect(settledAt).toBeGreaterThan(0);
      expect(returnedAt).toBeGreaterThanOrEqual(settledAt);
      // El paso queda `running`: la corrida se retoma desde él.
      expect(t.progress.current()[3]?.state).toBe('running');
      expect(t.calls).not.toContain('build_views');
    });

    it('un paso que termina dentro de la gracia se da por bueno', async () => {
      const shutdown = new AbortController();
      const t = setup(
        {
          load: async () => {
            shutdown.abort();
            await sleep(20);
            return 'ok';
          },
        },
        memoryProgress(),
        { stepDeadlineMs: 5_000, shutdownGraceMs: 500 },
      );

      const outcome = await t.processor.execute(
        t.execution({ shutdown: shutdown.signal }),
      );

      expect(outcome).toEqual({ status: 'stopped', reason: 'drained' });
      expect(t.progress.current()[3]).toMatchObject({
        state: 'succeeded',
        output: 'ok',
      });
    });
  });

  describe('plazo por paso', () => {
    it('al vencer se cancela el paso, se espera a que termine y falla de forma reintentable', async () => {
      let signal: AbortSignal | undefined;
      const t = setup(
        {
          scrape: (context) => {
            signal = context.signal;
            return untilAborted(20)(context);
          },
        },
        memoryProgress(),
        { stepDeadlineMs: 30, shutdownGraceMs: 1_000 },
      );

      const outcome = await t.processor.execute(t.execution());

      expect(outcome).toMatchObject({
        status: 'failed',
        step: 'scrape',
        errorClass: 'retryable',
        message: 'scrape: el paso scrape superó el plazo de 0.03 s',
      });
      expect(signal?.aborted).toBe(true);
      expect(signal?.reason).toBeInstanceOf(StepDeadlineError);
      expect(t.progress.current()[0]).toMatchObject({
        state: 'failed',
        error: 'scrape: el paso scrape superó el plazo de 0.03 s',
      });
    });

    it('si el paso falla con otro error por la cancelación, se informa el plazo y se guarda la causa', async () => {
      const t = setup(
        {
          scrape: async ({ signal }) => {
            await new Promise<void>((resolve) =>
              signal.addEventListener('abort', () => resolve(), { once: true }),
            );
            throw new Error('socket cerrado');
          },
        },
        memoryProgress(),
        { stepDeadlineMs: 20, shutdownGraceMs: 1_000 },
      );

      const outcome = await t.processor.execute(t.execution());

      expect(outcome).toMatchObject({
        status: 'failed',
        errorClass: 'retryable',
        message:
          'scrape: el paso scrape superó el plazo de 0.02 s\ncausa: socket cerrado',
      });
    });

    it('un paso a tiempo no se cancela y el plazo no se arrastra al siguiente', async () => {
      const t = setup({}, memoryProgress(), {
        stepDeadlineMs: 50,
        shutdownGraceMs: 1_000,
      });

      await t.processor.execute(t.execution());
      await sleep(80);

      for (const context of t.contexts)
        expect(context.signal.aborted).toBe(false);
    });
  });
});
