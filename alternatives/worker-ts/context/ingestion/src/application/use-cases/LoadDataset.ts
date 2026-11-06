import type { TableName } from '../../domain/index.ts';
import { validateStaging } from '../../domain/index.ts';
import type { DatasetLoader } from '../ports/DatasetLoader.ts';
import type { StagingStore } from '../ports/StagingStore.ts';
import type { StepContext } from '../ports/StepContext.ts';

export interface LoadOutput {
  /** Filas cargadas por tabla (sin las descartadas). */
  readonly counts: Record<TableName, number>;
}

/**
 * Paso `load`: relee y revalida staging (lo que se carga es exactamente lo validado) y
 * reemplaza las 6 tablas finales en una transacción.
 */
export class LoadDataset {
  private readonly staging: StagingStore;
  private readonly loader: DatasetLoader;

  constructor(staging: StagingStore, loader: DatasetLoader) {
    this.staging = staging;
    this.loader = loader;
  }

  async execute(context: StepContext): Promise<LoadOutput> {
    const { discardedIds } = validateStaging(await this.staging.readAll());
    context.signal.throwIfAborted();
    return { counts: await this.loader.load(discardedIds, context) };
  }
}
