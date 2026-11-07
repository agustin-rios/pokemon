import {
  BadGatewayException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
  type INestApplication,
} from '@nestjs/common';
import { AirflowClient } from '../../../src/modules/etl/airflow.client.ts';
import {
  EtlController,
  POKEMON_ETL_DAG_ID,
} from '../../../src/modules/etl/etl.controller.ts';
import { startApp } from '../../helpers.ts';

describe('EtlController', () => {
  const airflow = { triggerDag: vi.fn(), retryDagRun: vi.fn() };
  let app: INestApplication;
  let url: (path: string) => string;

  beforeAll(async () => {
    ({ app, url } = await startApp(EtlController, [
      { provide: AirflowClient, useValue: airflow },
    ]));
  });

  afterAll(() => app.close());
  beforeEach(() => vi.resetAllMocks());

  it('POST /etl/runs dispara pokemon_etl → 202 con la corrida', async () => {
    const run = {
      dagId: 'pokemon_etl',
      runId: 'manual__2026-11-05T17:00:00+00:00',
      state: 'queued',
      queuedAt: '2026-11-05T17:00:00Z',
    };
    airflow.triggerDag.mockResolvedValue(run);

    const res = await fetch(url('/etl/runs'), { method: 'POST' });

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual(run);
    expect(airflow.triggerDag).toHaveBeenCalledWith(POKEMON_ETL_DAG_ID);
  });

  it('POST /etl/runs/:runId/retry retoma esa corrida → 202', async () => {
    const runId = 'manual__2026-11-05T17:00:00+00:00';
    const run = {
      dagId: 'pokemon_etl',
      runId,
      state: 'queued',
      queuedAt: '2026-11-05T17:00:00Z',
    };
    airflow.retryDagRun.mockResolvedValue(run);

    const res = await fetch(
      url(`/etl/runs/${encodeURIComponent(runId)}/retry`),
      { method: 'POST' },
    );

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual(run);
    expect(airflow.retryDagRun).toHaveBeenCalledWith(POKEMON_ETL_DAG_ID, runId);
  });

  it.each([
    [new NotFoundException('No existe la corrida x'), 404],
    [new ConflictException('La corrida no tiene tareas fallidas'), 409],
  ])('retry: si el cliente lanza %s → %i', async (error, status) => {
    airflow.retryDagRun.mockRejectedValue(error);

    const res = await fetch(url('/etl/runs/x/retry'), { method: 'POST' });

    expect(res.status).toBe(status);
  });

  it.each([
    [new ServiceUnavailableException('Airflow no está disponible.'), 503],
    [new BadGatewayException('Airflow respondió 401.'), 502],
  ])('si el cliente lanza %s → %i', async (error, status) => {
    airflow.triggerDag.mockRejectedValue(error);

    const res = await fetch(url('/etl/runs'), { method: 'POST' });

    expect(res.status).toBe(status);
  });
});
