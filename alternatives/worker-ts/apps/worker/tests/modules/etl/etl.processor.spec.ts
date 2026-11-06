import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  DataValidationError,
  ExecuteEtlRun,
  type StepName,
} from '@pokemon/context-ingestion';
import { HttpStatusError } from '@pokemon/pokemon-data';
import { UnrecoverableError, WaitingError, type Job } from 'bullmq';
import { EtlProcessor } from '../../../src/modules/etl/etl.processor.ts';

type Execute = (context: {
  signal: AbortSignal;
  fence: { assertOwned(): Promise<void> };
}) => Promise<unknown>;

const NAMES: StepName[] = [
  'scrape',
  'generate',
  'validate',
  'load',
  'build_views',
];

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function fakeJob(steps?: unknown[], extended = 1) {
  return {
    id: 'run-1',
    progress: steps ? { steps } : 0,
    updateProgress: vi.fn().mockResolvedValue(undefined),
    extendLock: vi.fn().mockResolvedValue(extended),
    moveToWait: vi.fn().mockResolvedValue(undefined),
  };
}

const asJob = (job: ReturnType<typeof fakeJob>) => job as unknown as Job;

/** El procesador de Nest con los 5 pasos stub: los que no se indican terminan sin hacer nada. */
async function createProcessor(
  overrides: Partial<Record<StepName, Execute>> = {},
) {
  const noop: Execute = () => Promise.resolve(null);
  const steps = Object.fromEntries(
    NAMES.map((name) => [name, { execute: overrides[name] ?? noop }]),
  ) as ConstructorParameters<typeof ExecuteEtlRun>[0];
  const moduleRef = await Test.createTestingModule({
    providers: [
      {
        provide: ExecuteEtlRun,
        useValue: new ExecuteEtlRun(steps, logger, {
          stepDeadlineMs: 5_000,
          shutdownGraceMs: 100,
        }),
      },
      { provide: ConfigService, useValue: { get: () => 30_000 } },
      EtlProcessor,
    ],
  }).compile();
  return moduleRef.get(EtlProcessor);
}

describe('EtlProcessor', () => {
  beforeEach(() => vi.clearAllMocks());

  it('una corrida sin fallos termina y guarda el progreso de cada paso', async () => {
    const processor = await createProcessor();
    const job = fakeJob();

    await expect(processor.process(asJob(job), 'tok')).resolves.toBeNull();

    // 2 guardados por paso: running y succeeded.
    expect(job.updateProgress).toHaveBeenCalledTimes(10);
    expect(job.moveToWait).not.toHaveBeenCalled();
  });

  it('retoma desde el progreso guardado: no repite los pasos exitosos', async () => {
    const scrape = vi.fn().mockResolvedValue(null);
    const generate = vi.fn().mockResolvedValue(null);
    const processor = await createProcessor({ scrape, generate });
    const job = fakeJob([
      {
        name: 'scrape',
        state: 'succeeded',
        attempts: 1,
        startedAt: null,
        finishedAt: null,
        error: null,
        output: { pokemon: 100 },
      },
    ]);

    await processor.process(asJob(job), 'tok');

    expect(scrape).not.toHaveBeenCalled();
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('un fallo permanente lanza UnrecoverableError con «<paso>: <error>»', async () => {
    const processor = await createProcessor({
      validate: () =>
        Promise.reject(
          new DataValidationError(['pokemon id 3: height debe ser > 0']),
        ),
    });

    const error = await processor
      .process(asJob(fakeJob()), 'tok')
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UnrecoverableError);
    expect((error as Error).message).toBe(
      'validate: 1 problema(s) en los datos:\n- pokemon id 3: height debe ser > 0',
    );
  });

  it('un fallo reintentable lanza un Error normal que conserva la causa', async () => {
    const cause = new HttpStatusError('http://x/pokemon/1', 503);
    const processor = await createProcessor({
      scrape: () => Promise.reject(cause),
    });

    const error = await processor
      .process(asJob(fakeJob()), 'tok')
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(UnrecoverableError);
    expect((error as Error).message).toMatch(/^scrape: /);
    expect((error as Error).cause).toBe(cause);
  });

  it('si pierde el lock se detiene y la corrida vuelve a la cola sin fallar', async () => {
    const processor = await createProcessor({
      scrape: ({ fence }) => fence.assertOwned().then(() => null),
    });
    const job = fakeJob(undefined, 0);

    await expect(processor.process(asJob(job), 'tok')).rejects.toBeInstanceOf(
      WaitingError,
    );

    expect(job.extendLock).toHaveBeenCalledWith('tok', 30_000);
    expect(job.moveToWait).toHaveBeenCalledWith('tok');
  });

  it('el apagado deja terminar el paso en curso, no empieza el siguiente y cierra el worker', async () => {
    let finishScrape: () => void = () => undefined;
    const generate = vi.fn().mockResolvedValue(null);
    const processor = await createProcessor({
      scrape: () =>
        new Promise((resolve) => {
          finishScrape = () => resolve(null);
        }),
      generate,
    });
    const close = vi.fn().mockResolvedValue(undefined);
    Reflect.set(processor, '_worker', { close });
    const job = fakeJob();

    const running = processor.process(asJob(job), 'tok');
    const settled = running.catch((e: unknown) => e);
    await vi.waitFor(() => expect(job.updateProgress).toHaveBeenCalled());

    await processor.beforeApplicationShutdown();
    finishScrape();

    expect(await settled).toBeInstanceOf(WaitingError);
    expect(generate).not.toHaveBeenCalled();
    expect(job.moveToWait).toHaveBeenCalledWith('tok');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('pasada la gracia del apagado abandona el paso y lo cancela', async () => {
    let aborted = false;
    const processor = await createProcessor({
      scrape: ({ signal }) =>
        new Promise((_, reject) => {
          signal.addEventListener('abort', () => {
            aborted = true;
            reject(signal.reason);
          });
        }),
    });
    Reflect.set(processor, '_worker', { close: vi.fn() });
    const job = fakeJob();

    const settled = processor
      .process(asJob(job), 'tok')
      .catch((e: unknown) => e);
    await vi.waitFor(() => expect(job.updateProgress).toHaveBeenCalled());
    await processor.beforeApplicationShutdown();

    expect(await settled).toBeInstanceOf(WaitingError);
    expect(aborted).toBe(true);
    expect(job.moveToWait).toHaveBeenCalledWith('tok');
  });

  it('falla si BullMQ no entrega el token del lock', async () => {
    const processor = await createProcessor();

    await expect(processor.process(asJob(fakeJob()))).rejects.toThrow(/token/);
  });
});
