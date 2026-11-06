import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AttemptsExhaustedError, HttpStatusError } from '../src/errors.ts';
import { fetchPokemon } from '../src/pokeapi.ts';
import { json, startServer, type TestServer } from './helpers/http-server.ts';

const bulbasaur = {
  id: 1,
  name: 'bulbasaur',
  height: 7,
  weight: 69,
  base_experience: 64,
  sprites: { front_default: null },
  types: [],
};

let server: TestServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

/** Servidor que responde con `respond(n)` en el intento n (1-based) y anota cuándo llegó cada uno. */
async function stub(
  respond: (attempt: number, res: ServerResponse, req: IncomingMessage) => void,
): Promise<{ baseUrl: string; arrivals: number[] }> {
  const arrivals: number[] = [];
  server = await startServer((req, res) => {
    // Reloj monótono: Date.now() puede retroceder si el sistema ajusta la hora.
    arrivals.push(performance.now());
    respond(arrivals.length, res, req);
  });
  return { baseUrl: server.baseUrl, arrivals };
}

const fast = { retryBaseDelayMs: 10 };

describe('fetchPokemon', () => {
  it('pide 1..limit, en orden de id, con la base indicada', async () => {
    server = await startServer((req, res) => {
      const id = Number(req.url?.split('/').pop());
      // Los primeros responden más lento: el resultado igual sale en orden.
      setTimeout(() => json(res, 200, { ...bulbasaur, id }), (10 - id) * 5);
    });
    const result = await fetchPokemon(10, {
      baseUrl: server.baseUrl,
      concurrency: 3,
    });
    expect(result.map((p) => p.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('limit 0 no pide nada y valida los argumentos', async () => {
    expect(await fetchPokemon(0)).toEqual([]);
    await expect(fetchPokemon(1026)).rejects.toThrow(RangeError);
    await expect(fetchPokemon(-1)).rejects.toThrow(RangeError);
    await expect(fetchPokemon(5, { concurrency: 0 })).rejects.toThrow(
      RangeError,
    );
  });

  it('reintenta 5xx con backoff exponencial y termina bien', async () => {
    const { baseUrl, arrivals } = await stub((n, res) =>
      n <= 3 ? json(res, 503, {}) : json(res, 200, bulbasaur),
    );
    const [p] = await fetchPokemon(1, { baseUrl, retryBaseDelayMs: 20 });
    expect(p?.name).toBe('bulbasaur');
    expect(arrivals).toHaveLength(4);
    // Esperas de 20, 40 y 80 ms (un poco de margen: los timers pueden adelantarse 1 ms).
    [20, 40, 80].forEach((wait, i) =>
      expect(arrivals[i + 1]! - arrivals[i]!).toBeGreaterThanOrEqual(wait - 2),
    );
  });

  it('reintenta tras un error de red', async () => {
    const { baseUrl, arrivals } = await stub((n, res) =>
      n === 1 ? res.destroy() : json(res, 200, bulbasaur),
    );
    expect(await fetchPokemon(1, { baseUrl, ...fast })).toHaveLength(1);
    expect(arrivals).toHaveLength(2);
  });

  it('reintenta tras un timeout', async () => {
    const { baseUrl, arrivals } = await stub((n, res) => {
      if (n > 1) json(res, 200, bulbasaur); // el primero nunca responde
    });
    expect(
      await fetchPokemon(1, { baseUrl, ...fast, timeoutMs: 50 }),
    ).toHaveLength(1);
    expect(arrivals).toHaveLength(2);
  });

  it('Retry-After numérico reemplaza el backoff', async () => {
    const { baseUrl, arrivals } = await stub((n, res) => {
      if (n > 1) return json(res, 200, bulbasaur);
      res.writeHead(429, { 'Retry-After': '1' }).end();
    });
    // Con backoff de 10 ms esperaría 10 ms; con Retry-After, 1 s.
    await fetchPokemon(1, { baseUrl, ...fast });
    expect(arrivals[1]! - arrivals[0]!).toBeGreaterThanOrEqual(950);
  });

  it('Retry-After 0 y fecha en el pasado reintentan de inmediato aunque el backoff sea largo', async () => {
    for (const retryAfter of [
      '0',
      new Date(Date.now() - 60_000).toUTCString(),
    ]) {
      const { baseUrl, arrivals } = await stub((n, res) => {
        if (n > 1) return json(res, 200, bulbasaur);
        res.writeHead(503, { 'Retry-After': retryAfter }).end();
      });
      await fetchPokemon(1, { baseUrl, retryBaseDelayMs: 60_000 });
      expect(arrivals).toHaveLength(2);
      await server?.close();
    }
  });

  it('Retry-After con fecha futura espera hasta esa fecha', async () => {
    const { baseUrl, arrivals } = await stub((n, res) => {
      if (n > 1) return json(res, 200, bulbasaur);
      res
        .writeHead(429, {
          'Retry-After': new Date(Date.now() + 3000).toUTCString(),
        })
        .end();
    });
    await fetchPokemon(1, { baseUrl, ...fast });
    // La fecha HTTP tiene resolución de 1 s: la espera real es de 2 a 3 s. El
    // mínimo es holgado porque el reloj de pared (Date) puede saltar en algunos entornos.
    expect(arrivals[1]! - arrivals[0]!).toBeGreaterThanOrEqual(1000);
  });

  it('un 4xx que no es 429 falla de inmediato, sin reintentar', async () => {
    const { baseUrl, arrivals } = await stub((_, res) => json(res, 404, {}));
    const error = await fetchPokemon(1, { baseUrl, ...fast }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(HttpStatusError);
    expect(error).toMatchObject({ url: `${baseUrl}/pokemon/1`, status: 404 });
    expect((error as Error).message).toBe(
      `GET ${baseUrl}/pokemon/1 respondió HTTP 404`,
    );
    expect(arrivals).toHaveLength(1);
  });

  it('tras 4 intentos fallidos informa el error y no hace un quinto', async () => {
    const { baseUrl, arrivals } = await stub((_, res) => json(res, 500, {}));
    const error = await fetchPokemon(1, { baseUrl, ...fast }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(AttemptsExhaustedError);
    expect((error as Error).message).toBe(
      `GET ${baseUrl}/pokemon/1 falló tras 4 intentos`,
    );
    // La causa raíz se conserva: el último fallo fue un HTTP 500.
    expect((error as Error).cause).toMatchObject({
      name: 'HttpStatusError',
      status: 500,
    });
    expect(arrivals).toHaveLength(4);
  });

  it('el primer error corta el resto y es el que se informa', async () => {
    const { baseUrl, arrivals } = await stub((_, res, req) => {
      if (req.url?.endsWith('/pokemon/2')) json(res, 404, {});
      else setTimeout(() => json(res, 200, bulbasaur), 100);
    });
    await expect(
      fetchPokemon(50, { baseUrl, ...fast, concurrency: 2 }),
    ).rejects.toThrow('/pokemon/2 respondió HTTP 404');
    expect(arrivals.length).toBeLessThan(10);
  });

  it('con la señal ya abortada no pide nada y se rechaza con su motivo', async () => {
    const { baseUrl, arrivals } = await stub((_, res) =>
      json(res, 200, bulbasaur),
    );
    const reason = new Error('cancelado');
    await expect(
      fetchPokemon(5, { baseUrl, signal: AbortSignal.abort(reason) }),
    ).rejects.toBe(reason);
    expect(arrivals).toHaveLength(0);
  });

  it('abortar en pleno request corta la descarga con el motivo de la señal', async () => {
    const { baseUrl, arrivals } = await stub(() => undefined); // nunca responde
    const controller = new AbortController();
    const reason = new Error('plazo');
    const pending = fetchPokemon(5, { baseUrl, signal: controller.signal });
    await vi.waitFor(() => expect(arrivals.length).toBeGreaterThan(0));
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });

  it('abortar durante la espera entre reintentos también corta con el motivo', async () => {
    const { baseUrl, arrivals } = await stub((_, res) => json(res, 503, {}));
    const controller = new AbortController();
    const reason = new Error('apagado');
    const pending = fetchPokemon(1, {
      baseUrl,
      retryBaseDelayMs: 60_000,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(arrivals).toHaveLength(1));
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(arrivals).toHaveLength(1);
  });
});
