import type { Pokemon } from '../../domain/entities/Pokemon.ts';
import { ValidationError } from '../errors.ts';
import type { Page, PokemonRepository } from '../ports/PokemonRepository.ts';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export interface ListPokemonInput {
  page?: number;
  pageSize?: number;
}

/** Lista paginada de Pokémon, ordenada por id. */
export class ListPokemon {
  private readonly repository: PokemonRepository;

  constructor(repository: PokemonRepository) {
    this.repository = repository;
  }

  execute(input: ListPokemonInput = {}): Promise<Page<Pokemon>> {
    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? DEFAULT_PAGE_SIZE;
    if (!Number.isInteger(page) || page < 1) {
      throw new ValidationError('page debe ser un entero ≥ 1');
    }
    if (
      !Number.isInteger(pageSize) ||
      pageSize < 1 ||
      pageSize > MAX_PAGE_SIZE
    ) {
      throw new ValidationError(
        `pageSize debe ser un entero entre 1 y ${MAX_PAGE_SIZE}`,
      );
    }
    return this.repository.list({ page, pageSize });
  }
}
