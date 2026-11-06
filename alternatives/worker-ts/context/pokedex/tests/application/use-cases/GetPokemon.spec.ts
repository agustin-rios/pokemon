import { ValidationError } from '../../../src/application/errors.ts';
import { GetPokemon } from '../../../src/application/use-cases/GetPokemon.ts';
import type { Pokemon } from '../../../src/domain/entities/Pokemon.ts';
import { stubPokemonRepository } from '../../stubs.ts';

const bulbasaur: Pokemon = {
  id: 1,
  name: 'bulbasaur',
  height: 7,
  weight: 69,
  baseExperience: 64,
  sprite: null,
  types: [
    { id: 12, name: 'grass', slot: 1 },
    { id: 4, name: 'poison', slot: 2 },
  ],
};

describe('GetPokemon', () => {
  it('devuelve el Pokémon del repositorio', async () => {
    const repo = stubPokemonRepository();
    repo.findById.mockResolvedValue(bulbasaur);

    await expect(new GetPokemon(repo).execute(1)).resolves.toBe(bulbasaur);
    expect(repo.findById).toHaveBeenCalledWith(1);
  });

  it('devuelve null si no existe (la API responde 404)', async () => {
    const repo = stubPokemonRepository();
    repo.findById.mockResolvedValue(null);
    await expect(new GetPokemon(repo).execute(999)).resolves.toBeNull();
  });

  it.each([0, -1, 1.5, Number.NaN])(
    'rechaza el id %s sin consultar el repositorio',
    (id) => {
      const repo = stubPokemonRepository();
      expect(() => new GetPokemon(repo).execute(id)).toThrow(ValidationError);
      expect(repo.findById).not.toHaveBeenCalled();
    },
  );
});
