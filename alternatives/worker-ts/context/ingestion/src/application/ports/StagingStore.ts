import type { Dataset, SyntheticData } from '@pokemon/pokemon-data';
import type { StagingRows } from '../../domain/index.ts';
import type { StepContext } from './StepContext.ts';

/**
 * Las tablas de staging: los datos de la corrida entre un paso y otro. Cada escritura
 * reemplaza sus tablas en una transacción que solo se confirma si el cerco sigue siendo
 * de la ejecución; si falla o se cancela, los datos anteriores quedan intactos.
 */
export interface StagingStore {
  /** Reemplaza types, pokemon y pokemon_types. */
  replaceScraped(dataset: Dataset, context: StepContext): Promise<void>;

  /** Ids distintos y no nulos de pokemon, ordenados. */
  findPokemonIds(): Promise<number[]>;

  /** Reemplaza trainers, captures y battles. */
  replaceGenerated(data: SyntheticData, context: StepContext): Promise<void>;

  /** Las 6 tablas, ordenadas por clave y con los NULL al final. */
  readAll(): Promise<StagingRows>;
}
