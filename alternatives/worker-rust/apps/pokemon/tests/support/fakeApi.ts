import type { Mocked } from 'vitest';
import { ApiError } from '../../src/api/client.ts';
import type { PokedexApi, Pokemon } from '../../src/api/pokedexApi.ts';

export function makePokemon(id: number, types = ['grass']): Pokemon {
  return {
    id,
    name: `pokemon-${id}`,
    height: 7,
    weight: 69,
    baseExperience: 64,
    sprite: `https://img.test/${id}.png`,
    types: types.map((name, i) => ({ id: i + 1, name, slot: i + 1 })),
  };
}

/** 30 Pokémon: con páginas de 12 son 3 páginas (12, 12 y 6). */
export const ALL_POKEMON = Array.from({ length: 30 }, (_, i) =>
  makePokemon(i + 1, i % 2 ? ['fire', 'flying'] : ['grass']),
);

/**
 * API falsa con datos por defecto; cada método es un vi.fn() que el test puede
 * reemplazar (p. ej. para simular un 503) y del que puede contar las llamadas.
 */
export function fakeApi(): Mocked<PokedexApi> {
  return {
    health: vi.fn().mockResolvedValue({ status: 'ok' }),
    listPokemon: vi.fn(async ({ page, pageSize }) => ({
      items: ALL_POKEMON.slice((page - 1) * pageSize, page * pageSize),
      total: ALL_POKEMON.length,
      page,
      pageSize,
    })),
    getPokemon: vi.fn(async (id: number) => {
      const pokemon = ALL_POKEMON.find((p) => p.id === id);
      if (!pokemon) throw new ApiError(404, `No existe el Pokémon ${id}`);
      return pokemon;
    }),
    getTypeSummary: vi.fn().mockResolvedValue([
      {
        typeId: 10,
        typeName: 'fire',
        pokemonCount: 15,
        averageBaseExperience: 145.08,
      },
      {
        typeId: 12,
        typeName: 'grass',
        pokemonCount: 15,
        averageBaseExperience: 99.6,
      },
    ]),
    getMonthlyGrowth: vi.fn().mockResolvedValue([
      { month: '2025-11', captures: 233, changePercent: null },
      { month: '2025-12', captures: 244, changePercent: 4.72 },
      { month: '2026-01', captures: 200, changePercent: -18.03 },
    ]),
    getTopTrainers: vi.fn().mockResolvedValue([
      {
        region: 'Johto',
        rank: 1,
        trainerId: 12,
        trainerName: 'Blue Harrison',
        captures: 1270,
      },
      {
        region: 'Kanto',
        rank: 1,
        trainerId: 3,
        trainerName: 'Ash Ketchum',
        captures: 544,
      },
      {
        region: 'Kanto',
        rank: 2,
        trainerId: 7,
        trainerName: 'Misty Waterflower',
        captures: 141,
      },
    ]),
    getLevelClassification: vi.fn().mockResolvedValue([
      {
        typeId: 7,
        typeName: 'bug',
        totalCaptures: 1044,
        highLevelCaptures: 140,
        highLevelPercent: 13.41,
      },
    ]),
    triggerEtl: vi.fn().mockResolvedValue({
      runId: '3f1c2a9e-6b7d-4e58-9a41-0c5d8e7f1a22',
      state: 'queued',
      queuedAt: '2026-11-05T12:00:00.000Z',
      startedAt: null,
      finishedAt: null,
      attempts: 0,
      error: null,
      steps: [],
    }),
  };
}

/** Respuesta de la API cuando la base aún no tiene los datos. */
export const dataNotLoaded = () =>
  new ApiError(503, 'Los datos todavía no están cargados.');
