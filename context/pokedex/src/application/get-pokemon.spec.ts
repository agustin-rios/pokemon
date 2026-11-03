import { GetPokemon } from './get-pokemon.ts';
import { InMemoryPokemonRepository } from '../infra/adapters/index.ts';

describe('GetPokemon', () => {
  const useCase = new GetPokemon(
    new InMemoryPokemonRepository([{ id: 25, name: 'pikachu' }]),
  );

  it('devuelve el pokemon cuando existe', async () => {
    await expect(useCase.execute(25)).resolves.toEqual({
      id: 25,
      name: 'pikachu',
    });
  });

  it('falla si no existe', async () => {
    await expect(useCase.execute(1)).rejects.toThrow(/not found/);
  });
});
