import type { DiscardableTable, TableName } from '../../domain/index.ts';
import type { StepContext } from './StepContext.ts';

/** Pasa los datos de staging a las 6 tablas finales. */
export interface DatasetLoader {
  /**
   * Reemplaza el contenido de las tablas en una sola transacción: si algo falla los
   * datos anteriores quedan intactos. Excluye las capturas y batallas descartadas y,
   * justo antes de confirmar, verifica el cerco. Devuelve las filas cargadas por tabla.
   */
  load(
    discardedIds: Readonly<Record<DiscardableTable, readonly number[]>>,
    context: StepContext,
  ): Promise<Record<TableName, number>>;
}
