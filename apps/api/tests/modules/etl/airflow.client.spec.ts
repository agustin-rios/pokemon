import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  BadGatewayException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AirflowClient } from '../../../src/modules/etl/airflow.client.ts';

interface Received {
  method?: string;
  url?: string;
  authorization?: string;
  body: unknown;
}

/** Airflow falso: responde lo que diga `routes` y guarda cada request. */
function fakeAirflow(routes: Record<string, [number, unknown]>) {
  const received: Received[] = [];
  const server = createServer(async (req: IncomingMessage, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    received.push({
      method: req.method,
      url: req.url,
      authorization: req.headers.authorization,
      body: raw ? JSON.parse(raw) : undefined,
    });
    const [status, payload] = routes[`${req.method} ${req.url}`] ?? [404, {}];
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  });
  return { server, received };
}

const listen = (server: Server) =>
  new Promise<string>((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`),
    ),
  );

const close = (server: Server) =>
  new Promise<void>((resolve) => server.close(() => resolve()));

const dagRun = {
  dag_id: 'pokemon_etl',
  dag_run_id: 'manual__2026-11-05T17:00:00+00:00',
  state: 'queued',
  queued_at: '2026-11-05T17:00:00Z',
  run_type: 'manual',
  conf: {},
};

describe('AirflowClient', () => {
  beforeAll(() => Logger.overrideLogger(false));

  it('pide un token y dispara el DAG con él', async () => {
    const { server, received } = fakeAirflow({
      'POST /auth/token': [201, { access_token: 'jwt' }],
      'POST /api/v2/dags/pokemon_etl/dagRuns': [200, dagRun],
    });
    const url = await listen(server);
    const client = new AirflowClient({
      url,
      username: 'airflow',
      password: 'secret',
    });

    try {
      await expect(client.triggerDag('pokemon_etl')).resolves.toEqual({
        dagId: 'pokemon_etl',
        runId: 'manual__2026-11-05T17:00:00+00:00',
        state: 'queued',
        queuedAt: '2026-11-05T17:00:00Z',
      });
    } finally {
      await close(server);
    }

    expect(received).toEqual([
      {
        method: 'POST',
        url: '/auth/token',
        authorization: undefined,
        body: { username: 'airflow', password: 'secret' },
      },
      {
        method: 'POST',
        url: '/api/v2/dags/pokemon_etl/dagRuns',
        authorization: 'Bearer jwt',
        body: { logical_date: null },
      },
    ]);
  });

  it.each([
    [
      'credenciales inválidas',
      { 'POST /auth/token': [401, { detail: 'Invalid credentials' }] },
    ],
    [
      'el DAG no existe',
      {
        'POST /auth/token': [201, { access_token: 'jwt' }],
        'POST /api/v2/dags/pokemon_etl/dagRuns': [
          404,
          { detail: 'DAG not found' },
        ],
      },
    ],
    [
      'una respuesta sin la forma esperada',
      {
        'POST /auth/token': [201, { access_token: 'jwt' }],
        'POST /api/v2/dags/pokemon_etl/dagRuns': [200, { ok: true }],
      },
    ],
  ] as [string, Record<string, [number, unknown]>][])(
    '%s → 502',
    async (_case, routes) => {
      const { server } = fakeAirflow(routes);
      const url = await listen(server);
      const client = new AirflowClient({ url, username: 'a', password: 'b' });

      try {
        await expect(client.triggerDag('pokemon_etl')).rejects.toBeInstanceOf(
          BadGatewayException,
        );
      } finally {
        await close(server);
      }
    },
  );

  it('Airflow no responde → 503', async () => {
    const { server } = fakeAirflow({});
    const url = await listen(server);
    await close(server); // el puerto queda libre: la conexión se rechaza

    const client = new AirflowClient({ url, username: 'a', password: 'b' });

    await expect(client.triggerDag('pokemon_etl')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
