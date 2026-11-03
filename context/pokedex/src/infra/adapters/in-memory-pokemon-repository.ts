import type { Pokemon } from '../../domain/index.ts';
import type { PokemonRepository } from '../../application/index.ts';

export class InMemoryPokemonRepository implements PokemonRepository {
  constructor(private readonly items: Pokemon[] = []) {}

  async findById(id: number): Promise<Pokemon | null> {
    return this.items.find((p) => p.id === id) ?? null;
  }
}
