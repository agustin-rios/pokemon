import type { Pokemon } from '../domain/index.ts';

export interface PokemonRepository {
  findById(id: number): Promise<Pokemon | null>;
}
