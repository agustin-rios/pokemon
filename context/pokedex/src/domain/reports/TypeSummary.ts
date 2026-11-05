/**
 * GET /items/summary: cuántos Pokémon tiene cada tipo y su experiencia base
 * promedio. Un Pokémon con dos tipos cuenta en ambos. Vista `type_summary`.
 */
export interface TypeSummary {
  readonly typeId: number;
  readonly typeName: string;
  readonly pokemonCount: number;
  /** Redondeado a 2 decimales. */
  readonly averageBaseExperience: number;
}
