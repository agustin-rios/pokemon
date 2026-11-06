import type { INestApplication } from '@nestjs/common';
import {
  EnqueueEtlRun,
  EnqueueFailedError,
  GetEtlRun,
  RetryEtlRun,
  RunConflictError,
  RunNotFoundError,
  type EtlRun,
} from '@pokemon/context-ingestion';
import { EtlController } from '../../../src/modules/etl/etl.controller.ts';
import { startApp } from '../../helpers.ts';

const RUN_ID = '3f1c9a52-7d0e-4c58-9a51-0c8f6b2d4e11';

const run: EtlRun = {
  runId: RUN_ID,
  state: 'queued',
  queuedAt: '2026-11-05T22:19:30.778Z',
  startedAt: null,
  finishedAt: null,
  attempts: 0,
  error: null,
  steps: ['scrape', 'generate', 'validate', 'load', 'build_views'].map(
    (name) => ({
      name,
      state: 'pending',
      attempts: 0,
      startedAt: null,
      finishedAt: null,
      error: null,
      output: null,
    }),
  ) as EtlRun['steps'],
};

describe('EtlController', () => {
  const enqueueEtlRun = { execute: vi.fn() };
  const getEtlRun = { execute: vi.fn() };
  const retryEtlRun = { execute: vi.fn() };
  let app: INestApplication;
  let url: (path: string) => string;

  beforeAll(async () => {
    ({ app, url } = await startApp(EtlController, [
      { provide: EnqueueEtlRun, useValue: enqueueEtlRun },
      { provide: GetEtlRun, useValue: getEtlRun },
      { provide: RetryEtlRun, useValue: retryEtlRun },
    ]));
  });

  afterAll(() => app.close());
  beforeEach(() => vi.resetAllMocks());

  it('POST /etl/runs encola la corrida → 202 con la corrida', async () => {
    enqueueEtlRun.execute.mockResolvedValue(run);

    const res = await fetch(url('/etl/runs'), { method: 'POST' });

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual(run);
  });

  it('POST /etl/runs → 500 si no se pudo encolar', async () => {
    enqueueEtlRun.execute.mockRejectedValue(new EnqueueFailedError());

    const res = await fetch(url('/etl/runs'), { method: 'POST' });

    expect(res.status).toBe(500);
  });

  it('GET /etl/runs/:runId devuelve la corrida con sus pasos', async () => {
    getEtlRun.execute.mockResolvedValue(run);

    const res = await fetch(url(`/etl/runs/${RUN_ID}`));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(run);
    expect(getEtlRun.execute).toHaveBeenCalledWith(RUN_ID);
  });

  it('GET /etl/runs/:runId → 404 si no existe', async () => {
    getEtlRun.execute.mockResolvedValue(null);

    const res = await fetch(url(`/etl/runs/${RUN_ID}`));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      message: `No existe la corrida ${RUN_ID}`,
      error: 'Not Found',
      statusCode: 404,
    });
  });

  it.each(['abc', '123', `${RUN_ID}x`])(
    'GET /etl/runs/%s → 400 si no es un UUID',
    async (id) => {
      const res = await fetch(url(`/etl/runs/${id}`));

      expect(res.status).toBe(400);
      expect(getEtlRun.execute).not.toHaveBeenCalled();
    },
  );

  it('POST /etl/runs/:runId/retry vuelve a encolar → 202 con la corrida', async () => {
    retryEtlRun.execute.mockResolvedValue(run);

    const res = await fetch(url(`/etl/runs/${RUN_ID}/retry`), {
      method: 'POST',
    });

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual(run);
    expect(retryEtlRun.execute).toHaveBeenCalledWith(RUN_ID);
  });

  it('POST /etl/runs/:runId/retry → 400 si no es un UUID', async () => {
    const res = await fetch(url('/etl/runs/abc/retry'), { method: 'POST' });

    expect(res.status).toBe(400);
    expect(retryEtlRun.execute).not.toHaveBeenCalled();
  });

  it('POST /etl/runs/:runId/retry → 404 si no existe', async () => {
    retryEtlRun.execute.mockRejectedValue(new RunNotFoundError(RUN_ID));

    const res = await fetch(url(`/etl/runs/${RUN_ID}/retry`), {
      method: 'POST',
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({
      message: `No existe la corrida ${RUN_ID}`,
    });
  });

  it.each([
    'Solo se puede reintentar una corrida fallida',
    'Ya hay una corrida en curso',
  ])('POST /etl/runs/:runId/retry → 409 «%s»', async (message) => {
    retryEtlRun.execute.mockRejectedValue(new RunConflictError(message));

    const res = await fetch(url(`/etl/runs/${RUN_ID}/retry`), {
      method: 'POST',
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ message });
  });
});
