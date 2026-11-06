import type { PokemonSource } from '../ports/PokemonSource.ts';
import type { StagingStore } from '../ports/StagingStore.ts';
import type { StepContext } from '../ports/StepContext.ts';

export interface ScrapeOutput {
  readonly pokemon: number;
  readonly types: number;
  readonly pokemonTypes: number;
}

/** Paso `scrape`: descarga los Pokémon 1..limit y los deja en staging (types, pokemon, pokemon_types). */
export class ScrapePokemon {
  private readonly source: PokemonSource;
  private readonly staging: StagingStore;
  private readonly limit: number;

  constructor(source: PokemonSource, staging: StagingStore, limit: number) {
    this.source = source;
    this.staging = staging;
    this.limit = limit;
  }

  async execute(context: StepContext): Promise<ScrapeOutput> {
    const dataset = await this.source.fetch(this.limit, context.signal);
    await this.staging.replaceScraped(dataset, context);
    return {
      pokemon: dataset.pokemon.length,
      types: dataset.types.length,
      pokemonTypes: dataset.pokemonTypes.length,
    };
  }
}
