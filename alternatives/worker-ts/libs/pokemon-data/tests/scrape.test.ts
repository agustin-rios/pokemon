import { afterAll, beforeAll, expect, it } from 'vitest';
import { fetchPokemon, toDataset } from '../src/index.ts';
import { asCells, readCsvRows } from './helpers/csv.ts';
import { startServer, type TestServer } from './helpers/http-server.ts';
import { pokeApiStub } from './helpers/pokeapi-stub.ts';

const fixtureDir = new URL('./fixtures/data-current/', import.meta.url);
const fixture = (name: string) => readCsvRows(new URL(name, fixtureDir));

let server: TestServer;
beforeAll(async () => {
  server = await startServer(pokeApiStub(fixtureDir.pathname));
});
afterAll(() => server.close());

it('scrapear un stub que sirve data-current reproduce sus filas', async () => {
  const dataset = toDataset(
    await fetchPokemon(100, { baseUrl: server.baseUrl }),
  );
  const cells = (rows: object[]) => rows.map(asCells);

  // En la fixture la columna del sprite se llama `sprite`; en las filas, como en la tabla, `sprite_url`.
  expect(cells(dataset.pokemon)).toEqual(
    fixture('pokemon.csv').map(({ sprite, ...rest }) => ({
      ...rest,
      sprite_url: sprite,
    })),
  );
  expect(cells(dataset.types)).toEqual(fixture('types.csv'));
  expect(cells(dataset.pokemonTypes)).toEqual(fixture('pokemon_types.csv'));
});
