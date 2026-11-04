import { setTimeout as sleep } from 'node:timers/promises';

const API_BASE_URL = 'https://pokeapi.co/api/v2';

export const MAX_POKEMON = 1025;

const HTTP_CONFIG = {
  timeoutMs: 15_000,
  maxAttempts: 4,
  retryBaseDelayMs: 500,
  defaultConcurrency: 8,
} as const;

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

export const POKEMON_COLUMNS = [
  'id',
  'name',
  'height',
  'weight',
  'base_experience',
  'sprite_url',
] as const;

export const TYPE_COLUMNS = ['id', 'name'] as const;

export const POKEMON_TYPE_COLUMNS = [
  'pokemon_id',
  'type_id',
  'slot',
] as const;

export function typeIdFromUrl(url: string): number {
  const pathname = new URL(url).pathname;
  const match = /\/type\/(\d+)\/?$/.exec(pathname);

  if (!match) {
    throw new Error(`URL de tipo inesperada: ${url}`);
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

export function toDataset(
  apiPokemon: readonly ApiPokemon[],
): Dataset {
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
      (a, b) =>
        a.pokemon_id - b.pokemon_id ||
        a.slot - b.slot,
    ),
  };
}

function getRetryDelay(
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

  return HTTP_CONFIG.retryBaseDelayMs * 2 ** attempt;
}

/**
 * GET JSON con timeout y reintentos para errores recuperables.
 */
async function getJson<T>(
  url: string,
  signal?: AbortSignal,
): Promise<T> {
  let lastError: unknown;

  for (
    let attempt = 0;
    attempt < HTTP_CONFIG.maxAttempts;
    attempt++
  ) {
    if (signal?.aborted) {
      throw signal.reason;
    }

    if (attempt > 0) {
      await sleep(getRetryDelay(attempt - 1), undefined, {
        signal,
      });
    }

    let response: Response;

    try {
      const timeoutSignal = AbortSignal.timeout(
        HTTP_CONFIG.timeoutMs,
      );

      const requestSignal = signal
        ? AbortSignal.any([signal, timeoutSignal])
        : timeoutSignal;

      response = await fetch(url, {
        signal: requestSignal,
      });
    } catch (error) {
      if (signal?.aborted) throw signal.reason;

      lastError = error;

      if (attempt === HTTP_CONFIG.maxAttempts - 1) {
        break;
      }

      continue;
    }

    if (response.ok) {
      return (await response.json()) as T;
    }

    if (response.status !== 429 && response.status < 500) {
      throw new Error(
        `GET ${url} respondió HTTP ${response.status}`,
      );
    }

    lastError = new Error(`HTTP ${response.status}`);

    if (attempt < HTTP_CONFIG.maxAttempts - 1) {
      await sleep(
        getRetryDelay(attempt, response),
        undefined,
        { signal },
      );
    }
  }

  throw new Error(
    `GET ${url} falló tras ${HTTP_CONFIG.maxAttempts} intentos`,
    { cause: lastError },
  );
}

export async function fetchPokemon(
  limit: number,
  concurrency = HTTP_CONFIG.defaultConcurrency,
): Promise<ApiPokemon[]> {
  if (!Number.isInteger(limit) || limit < 0 || limit > MAX_POKEMON) {
    throw new RangeError(
      `limit debe estar entre 0 y ${MAX_POKEMON}`,
    );
  }

  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError(
      'concurrency debe ser un entero positivo',
    );
  }

  if (limit === 0) return [];

  const results = new Array<ApiPokemon>(limit);

  const controller = new AbortController();
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (!controller.signal.aborted) {
      const index = nextIndex++;

      if (index >= limit) return;

      try {
        results[index] = await getJson<ApiPokemon>(
          `${API_BASE_URL}/pokemon/${index + 1}`,
          controller.signal,
        );
      } catch (error) {
        controller.abort(error);
        throw error;
      }
    }
  };

  const workerCount = Math.min(concurrency, limit);

  await Promise.all(
    Array.from({ length: workerCount }, () => worker()),
  );

  return results;
}