import type { Dataset } from '@pokemon/pokemon-data';

/** De dónde salen los Pokémon, sus tipos y sus slots (la PokeAPI). */
export interface PokemonSource {
  /** Los Pokémon 1..limit, ya ordenados. El primer error corta la descarga; `signal` la cancela. */
  fetch(limit: number, signal: AbortSignal): Promise<Dataset>;
}
