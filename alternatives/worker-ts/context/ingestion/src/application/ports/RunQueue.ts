import type { EtlRun } from '../../domain/index.ts';

/** La cola de corridas: solo hay una activa (en cola o corriendo) a la vez. */
export interface RunQueue {
  /** Encola una corrida, o devuelve la que ya está en cola o corriendo. */
  enqueue(): Promise<EtlRun>;

  /** null si no existe. */
  get(runId: string): Promise<EtlRun | null>;

  /**
   * Reintento manual: vuelve a encolar una corrida fallida; retoma desde el paso que
   * falló. Lanza RunNotFoundError si no existe y RunConflictError si no está fallida
   * o si ya hay otra activa.
   */
  retry(runId: string): Promise<EtlRun>;
}
