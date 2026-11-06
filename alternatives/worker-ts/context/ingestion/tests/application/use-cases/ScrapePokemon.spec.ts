import type { Dataset } from '@pokemon/pokemon-data';
import { ScrapePokemon } from '../../../src/application/use-cases/ScrapePokemon.ts';
import { ownedFence, stubStagingStore } from '../../stubs.ts';

const dataset: Dataset = {
  pokemon: [
    {
      id: 1,
      name: 'bulbasaur',
      height: 7,
      weight: 69,
      base_experience: 64,
      sprite_url: 'https://img/1.png',
    },
    {
      id: 2,
      name: 'ivysaur',
      height: 10,
      weight: 130,
      base_experience: null,
      sprite_url: null,
    },
  ],
  types: [
    { id: 4, name: 'poison' },
    { id: 12, name: 'grass' },
  ],
  pokemonTypes: [
    { pokemon_id: 1, type_id: 12, slot: 1 },
    { pokemon_id: 1, type_id: 4, slot: 2 },
  ],
};

const context = () => ({
  signal: new AbortController().signal,
  fence: ownedFence(),
});

describe('ScrapePokemon', () => {
  it('descarga con la señal del paso, escribe en staging con su contexto y cuenta las filas', async () => {
    const source = { fetch: vi.fn().mockResolvedValue(dataset) };
    const staging = stubStagingStore();
    const ctx = context();

    const output = await new ScrapePokemon(source, staging, 2).execute(ctx);

    expect(source.fetch).toHaveBeenCalledWith(2, ctx.signal);
    expect(staging.replaceScraped).toHaveBeenCalledWith(dataset, ctx);
    expect(output).toEqual({ pokemon: 2, types: 2, pokemonTypes: 2 });
  });

  it('si la descarga falla no escribe nada y propaga el error', async () => {
    const source = {
      fetch: vi.fn().mockRejectedValue(new Error('falló tras 4 intentos')),
    };
    const staging = stubStagingStore();

    await expect(
      new ScrapePokemon(source, staging, 2).execute(context()),
    ).rejects.toThrow('falló tras 4 intentos');
    expect(staging.replaceScraped).not.toHaveBeenCalled();
  });
});
