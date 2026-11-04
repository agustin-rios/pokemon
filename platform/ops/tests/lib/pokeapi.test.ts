import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
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
  assert.equal(dataset.pokemon[0]?.sprite_url, 'https://img/1.png');
});
