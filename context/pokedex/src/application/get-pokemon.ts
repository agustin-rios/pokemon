import type { Pokemon } from '../domain/index.ts';
import type { PokemonRepository } from './pokemon-repository.ts';

export class GetPokemon {
  constructor(private readonly repo: PokemonRepository) {}

  async execute(id: number): Promise<Pokemon> {
    const pokemon = await this.repo.findById(id);
    if (!pokemon) throw new Error(`Pokemon ${id} not found`);
    return pokemon;
  }
}
