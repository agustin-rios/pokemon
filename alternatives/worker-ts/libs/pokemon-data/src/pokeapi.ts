import { setTimeout as sleep } from 'node:timers/promises';
import {
  AttemptsExhaustedError,
  HttpStatusError,
  UnexpectedTypeUrlError,
} from './errors.ts';

export const DEFAULT_POKEAPI_URL = 'https://pokeapi.co/api/v2';

export const MAX_POKEMON = 1025;

const MAX_ATTEMPTS = 4;
const DEFAULT_CONCURRENCY = 8;

export interface FetchPokemonOptions {
  /** Base de la API (sin barra final). Por defecto la PokeAPI real. */
  baseUrl?: string;
  concurrency?: number;
  /** Tiempo máximo por request. Configurable para poder probarlo sin esperar 15 s. */
  timeoutMs?: number;
  /** Espera base entre reintentos (se duplica en cada uno). Configurable por la misma razón. */
  retryBaseDelayMs?: number;
  /** Cancela la descarga: aborta los requests en vuelo y no lanza más. Se rechaza con `signal.reason`. */
  signal?: AbortSignal;
}

interface HttpConfig {
  timeoutMs: number;
  retryBaseDelayMs: number;
}

export type PokemonRow = {
  id: number;
  name: string;
  height: number;
  weight: number;
  base_experience: number | null;
  sprite_url: string | null;
};

export type TypeRow = {
  id: number;
  name: string;
};

export type PokemonTypeRow = {
  pokemon_id: number;
  type_id: number;
  slot: number;
};

export interface ApiPokemon {
  id: number;
  name: string;
  height: number;
  weight: number;
  base_experience: number | null;
  sprites: {
    front_default: string | null;
  };
  types: {
    slot: number;
    type: {
      name: string;
      url: string;
    };
  }[];
}

export interface Dataset {
  pokemon: PokemonRow[];
  types: TypeRow[];
  pokemonTypes: PokemonTypeRow[];
}

export function typeIdFromUrl(url: string): number {
  const pathname = new URL(url).pathname;
  const match = /\/type\/(\d+)\/?$/.exec(pathname);

  if (!match) {
    throw new UnexpectedTypeUrlError(url);
  }

  return Number(match[1]);
}

function toPokemonRow(p: ApiPokemon): PokemonRow {
  return {
    id: p.id,
    name: p.name,
    height: p.height,
    weight: p.weight,
    base_experience: p.base_experience,
    sprite_url: p.sprites.front_default,
  };
}

export function toDataset(apiPokemon: readonly ApiPokemon[]): Dataset {
  const pokemon = new Map<number, PokemonRow>();
  const types = new Map<number, TypeRow>();
  const pokemonTypes: PokemonTypeRow[] = [];

  for (const p of apiPokemon) {
    pokemon.set(p.id, toPokemonRow(p));

    for (const { slot, type } of p.types) {
      const typeId = typeIdFromUrl(type.url);

      types.set(typeId, {
        id: typeId,
        name: type.name,
      });

      pokemonTypes.push({
        pokemon_id: p.id,
        type_id: typeId,
        slot,
      });
    }
  }

  return {
    pokemon: [...pokemon.values()].sort((a, b) => a.id - b.id),

    types: [...types.values()].sort((a, b) => a.id - b.id),

    pokemonTypes: pokemonTypes.sort(
      (a, b) => a.pokemon_id - b.pokemon_id || a.slot - b.slot,
    ),
  };
}

function getRetryDelay(
  config: HttpConfig,
  attempt: number,
  response?: Response,
): number {
  const retryAfter = response?.headers.get('Retry-After');

  if (retryAfter) {
    const seconds = Number(retryAfter);

    if (Number.isFinite(seconds) && seconds >= 0) {
      return seconds * 1000;
    }

    const date = Date.parse(retryAfter);

    if (Number.isFinite(date)) {
      return Math.max(0, date - Date.now());
    }
  }

  return config.retryBaseDelayMs * 2 ** attempt;
}

/**
 * GET JSON con timeout y reintentos para errores recuperables (red, 429, >= 500).
 * Entre un intento y el siguiente espera una sola vez: el Retry-After de la
 * respuesta si lo trae y, si no, el backoff exponencial.
 */
async function getJson<T>(
  url: string,
  config: HttpConfig,
  signal?: AbortSignal,
): Promise<T> {
  let lastError: unknown;
  let delayMs = 0;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      try {
        await sleep(delayMs, undefined, { signal });
      } catch (error) {
        if (signal?.aborted) throw signal.reason;
        throw error;
      }
    }

    if (signal?.aborted) {
      throw signal.reason;
    }

    let response: Response;

    try {
      const timeoutSignal = AbortSignal.timeout(config.timeoutMs);
      const requestSignal = signal
        ? AbortSignal.any([signal, timeoutSignal])
        : timeoutSignal;

      response = await fetch(url, { signal: requestSignal });
    } catch (error) {
      if (signal?.aborted) throw signal.reason;

      lastError = error;
      delayMs = getRetryDelay(config, attempt);
      continue;
    }

    if (response.ok) {
      return (await response.json()) as T;
    }

    if (response.status !== 429 && response.status < 500) {
      throw new HttpStatusError(url, response.status);
    }

    lastError = new HttpStatusError(url, response.status);
    delayMs = getRetryDelay(config, attempt, response);
  }

  throw new AttemptsExhaustedError(url, MAX_ATTEMPTS, lastError);
}

/** Descarga los Pokémon 1..limit, en orden de id. El primer error corta el resto. */
export async function fetchPokemon(
  limit: number,
  options: FetchPokemonOptions = {},
): Promise<ApiPokemon[]> {
  const {
    baseUrl = DEFAULT_POKEAPI_URL,
    concurrency = DEFAULT_CONCURRENCY,
    timeoutMs = 15_000,
    retryBaseDelayMs = 500,
    signal,
  } = options;
  const config = { timeoutMs, retryBaseDelayMs };

  if (!Number.isInteger(limit) || limit < 0 || limit > MAX_POKEMON) {
    throw new RangeError(`limit debe estar entre 0 y ${MAX_POKEMON}`);
  }

  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError('concurrency debe ser un entero positivo');
  }

  if (limit === 0) return [];

  signal?.throwIfAborted();

  const results = new Array<ApiPokemon>(limit);

  const controller = new AbortController();
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (!controller.signal.aborted) {
      const index = nextIndex++;

      if (index >= limit) return;

      try {
        results[index] = await getJson<ApiPokemon>(
          `${baseUrl}/pokemon/${index + 1}`,
          config,
          signal
            ? AbortSignal.any([signal, controller.signal])
            : controller.signal,
        );
      } catch (error) {
        controller.abort(error);
        throw error;
      }
    }
  };

  const workerCount = Math.min(concurrency, limit);

  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results;
}
