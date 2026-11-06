/**
 * Consulta B (top entrenadores): los 3 entrenadores con más capturas de cada
 * región, rankeados con una función de ventana. Vista `top_trainers_by_region`.
 */
export interface TopTrainer {
  readonly region: string;
  /** 1 a 3 dentro de la región; empates por capturas se ordenan por id. */
  readonly rank: number;
  readonly trainerId: number;
  readonly trainerName: string;
  readonly captures: number;
}
