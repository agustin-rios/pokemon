import { expect, it } from 'vitest';
import { UnexpectedTypeUrlError } from '../src/errors.ts';
import { toDataset, typeIdFromUrl, type ApiPokemon } from '../src/pokeapi.ts';

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

it('typeIdFromUrl toma el id del final de la URL', () => {
  expect(typeIdFromUrl('https://pokeapi.co/api/v2/type/12/')).toBe(12);
  expect(typeIdFromUrl('https://pokeapi.co/api/v2/type/12')).toBe(12);
  expect(typeIdFromUrl('https://pokeapi.co/api/v2/type/12/?x=1')).toBe(12);
  const wrong = () => typeIdFromUrl('https://pokeapi.co/api/v2/pokemon/1/');
  expect(wrong).toThrow(UnexpectedTypeUrlError);
  expect(wrong).toThrow(
    'URL de tipo inesperada: https://pokeapi.co/api/v2/pokemon/1/',
  );
});

it('toDataset ordena por id y deduplica tipos, sin importar el orden de llegada', () => {
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
  expect(dataset.pokemon.map((p) => p.id)).toEqual([1, 2, 4]);
  expect(dataset.types).toEqual([
    { id: 4, name: 'poison' },
    { id: 10, name: 'fire' },
    { id: 12, name: 'grass' },
  ]);
  expect(dataset.pokemonTypes).toEqual([
    { pokemon_id: 1, type_id: 12, slot: 1 },
    { pokemon_id: 1, type_id: 4, slot: 2 },
    { pokemon_id: 2, type_id: 12, slot: 1 },
    { pokemon_id: 2, type_id: 4, slot: 2 },
    { pokemon_id: 4, type_id: 10, slot: 1 },
  ]);
  expect(dataset.pokemon[0]?.sprite_url).toBe('https://img/1.png');
});

it('toDataset ordena los tipos de un Pokémon por slot', () => {
  const p = pokemon(1, 'bulbasaur', [
    ['grass', 12],
    ['poison', 4],
  ]);
  p.types.reverse();
  expect(toDataset([p]).pokemonTypes.map((t) => t.slot)).toEqual([1, 2]);
});

it('toDataset conserva los null de base_experience y sprite', () => {
  const p = pokemon(1, 'x', [['normal', 1]]);
  p.base_experience = null;
  p.sprites.front_default = null;
  expect(toDataset([p]).pokemon[0]).toMatchObject({
    base_experience: null,
    sprite_url: null,
  });
});
