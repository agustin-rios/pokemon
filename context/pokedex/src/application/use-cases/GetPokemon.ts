import type { Pokemon } from '../../domain/entities/Pokemon.ts';
import { ValidationError } from '../errors.ts';
import type { PokemonRepository } from '../ports/PokemonRepository.ts';

/** Un Pokémon por id; null si no existe (la API lo traduce a 404). */
export class GetPokemon {
  private readonly repository: PokemonRepository;

  constructor(repository: PokemonRepository) {
    this.repository = repository;
  }

  execute(id: number): Promise<Pokemon | null> {
    if (!Number.isInteger(id) || id < 1) {
      throw new ValidationError('id debe ser un entero ≥ 1');
    }
    return this.repository.findById(id);
  }
}
