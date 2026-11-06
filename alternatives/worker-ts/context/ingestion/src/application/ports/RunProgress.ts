import type { EtlStep } from '../../domain/index.ts';

/** El estado de los pasos de una corrida, guardado entre un paso y otro. */
export interface RunProgress {
  /** Los pasos guardados; vacío si la corrida aún no empezó. */
  load(): Promise<readonly EtlStep[]>;

  /** Reemplaza el estado de los pasos. */
  save(steps: readonly EtlStep[]): Promise<void>;
}
