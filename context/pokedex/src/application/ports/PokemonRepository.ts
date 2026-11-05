import type { Pokemon } from '../../domain/entities/Pokemon.ts';

export interface PageQuery {
  /** Desde 1. */
  readonly page: number;
  readonly pageSize: number;
}

export interface Page<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

/**
 * Catálogo de Pokémon (Repository Pattern): los casos de uso dependen de este
 * contrato y no de cómo se guardan los datos. Implementación en infra/adapters.
 */
export interface PokemonRepository {
  /** Ordenados por id, cada uno con sus tipos. */
  list(query: PageQuery): Promise<Page<Pokemon>>;

  findById(id: number): Promise<Pokemon | null>;
}
