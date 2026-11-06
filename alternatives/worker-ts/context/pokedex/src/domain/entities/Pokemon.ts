/** Un tipo asignado a un Pokémon; `slot` 1 es el principal y 2 el secundario. */
export interface PokemonType {
  readonly id: number;
  readonly name: string;
  readonly slot: number;
}

/**
 * Pokémon de la Pokédex. Solo lectura: los datos los carga el worker,
 * la aplicación no los crea ni los modifica.
 */
export interface Pokemon {
  readonly id: number;
  readonly name: string;
  readonly height: number;
  readonly weight: number;
  readonly baseExperience: number;
  /** URL de la imagen (columna `sprite` de la tabla `pokemon`). */
  readonly sprite: string | null;
  /** Ordenados por slot. */
  readonly types: readonly PokemonType[];
}
