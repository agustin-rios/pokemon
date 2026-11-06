import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { test, type TestContext } from 'node:test';
import {
  fetchPokemon,
  toDataset,
  typeIdFromUrl,
  type ApiPokemon,
} from '../../src/lib/pokeapi.ts';

const pokemon = (
  id: number,
  name: string,
  types: [string, number][],
): ApiPokemon => ({
  id,
  name,
  base_experience: id * 10,
  height: 1,
  weight: 1,
  sprites: { front_default: `https://img/${id}.png` },
  types: types.map(([typeName, typeId], i) => ({
    slot: i + 1,
    type: { name: typeName, url: `https://pokeapi.co/api/v2/type/${typeId}/` },
  })),
});

test('typeIdFromUrl toma el id del final de la URL', () => {
  assert.equal(typeIdFromUrl('https://pokeapi.co/api/v2/type/12/'), 12);
  assert.throws(() => typeIdFromUrl('https://pokeapi.co/api/v2/pokemon/1/'));
});

test('toDataset ordena por id y deduplica tipos, sin importar el orden de llegada', () => {
  const dataset = toDataset([
    pokemon(4, 'charmander', [['fire', 10]]),
    pokemon(1, 'bulbasaur', [
      ['grass', 12],
      ['poison', 4],
    ]),
    pokemon(2, 'ivysaur', [
      ['grass', 12],
      ['poison', 4],
    ]),
  ]);
  assert.deepEqual(
    dataset.pokemon.map((p) => p.id),
    [1, 2, 4],
  );
  assert.deepEqual(dataset.types, [
    { id: 4, name: 'poison' },
    { id: 10, name: 'fire' },
    { id: 12, name: 'grass' },
  ]);
  assert.deepEqual(dataset.pokemonTypes, [
    { pokemon_id: 1, type_id: 12, slot: 1 },
    { pokemon_id: 1, type_id: 4, slot: 2 },
    { pokemon_id: 2, type_id: 12, slot: 1 },
    { pokemon_id: 2, type_id: 4, slot: 2 },
    { pokemon_id: 4, type_id: 10, slot: 1 },
  ]);
  assert.equal(dataset.pokemon[0]?.sprite, 'https://img/1.png');
});

/**
 * Simula `fetch` con una respuesta (o un error) por intento y mide cuánto tarda
 * `fetchPokemon(1)` (reloj monotónico: el de pared puede saltar).
 */
async function timedFetch(
  t: TestContext,
  attempts: (Response | Error)[],
): Promise<{ elapsedMs: number; calls: number }> {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
    const next = attempts.shift();
    if (!next) throw new Error('fetch llamado más veces de lo esperado');
    if (next instanceof Error) throw next;
    return next;
  });
  const start = performance.now();
  const [result] = await fetchPokemon(1);
  const elapsedMs = performance.now() - start;
  assert.equal(result?.name, 'bulbasaur');
  return { elapsedMs, calls: fetchMock.mock.callCount() };
}

const ok = () =>
  new Response(JSON.stringify(pokemon(1, 'bulbasaur', [['grass', 12]])), {
    headers: { 'Content-Type': 'application/json' },
  });

test('tras un 429 con Retry-After: 0 reintenta sin sumarle el backoff', async (t) => {
  const { elapsedMs, calls } = await timedFetch(t, [
    new Response(null, { status: 429, headers: { 'Retry-After': '0' } }),
    ok(),
  ]);
  assert.equal(calls, 2);
  assert.ok(elapsedMs < 250, `esperó ${elapsedMs} ms`);
});

test('tras un 503 sin Retry-After espera una sola vez el backoff (500 ms)', async (t) => {
  const { elapsedMs, calls } = await timedFetch(t, [
    new Response(null, { status: 503 }),
    ok(),
  ]);
  assert.equal(calls, 2);
  assert.ok(elapsedMs >= 450 && elapsedMs < 900, `esperó ${elapsedMs} ms`);
});

test('tras un error de red espera el backoff (500 ms) y reintenta', async (t) => {
  const { elapsedMs, calls } = await timedFetch(t, [
    new TypeError('fetch failed'),
    ok(),
  ]);
  assert.equal(calls, 2);
  assert.ok(elapsedMs >= 450 && elapsedMs < 900, `esperó ${elapsedMs} ms`);
});
