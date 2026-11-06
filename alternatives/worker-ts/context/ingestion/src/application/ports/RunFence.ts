/**
 * El cerco de una ejecución: comprueba que sigue siendo la dueña de la corrida.
 * Los adaptadores de escritura lo consultan dentro de la transacción, justo antes
 * de confirmar: si ya no lo es, revierten y dejan pasar el error.
 */
export interface RunFence {
  /** Lanza FenceLostError si la ejecución perdió la corrida (p. ej. venció su lock). */
  assertOwned(): Promise<void>;
}
