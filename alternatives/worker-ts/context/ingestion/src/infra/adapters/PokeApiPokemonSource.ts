import { fetchPokemon, toDataset, type Dataset } from '@pokemon/pokemon-data';

import type { PokemonSource } from '../../application/ports/PokemonSource.ts';

/** La PokeAPI (o un espejo, con `POKEAPI_URL`). */
export class PokeApiPokemonSource implements PokemonSource {
  private readonly baseUrl: string | undefined;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl;
  }

  async fetch(limit: number, signal: AbortSignal): Promise<Dataset> {
    return toDataset(
      await fetchPokemon(limit, { baseUrl: this.baseUrl, signal }),
    );
  }
}
