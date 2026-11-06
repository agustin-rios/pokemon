import type { TableName } from '../../domain/index.ts';
import { validateStaging } from '../../domain/index.ts';
import type { Logger } from '../ports/Logger.ts';
import type { StagingStore } from '../ports/StagingStore.ts';
import type { StepContext } from '../ports/StepContext.ts';

export interface ValidateOutput {
  /** Filas leídas por tabla. */
  readonly counts: Record<TableName, number>;
  /** Solo las tablas que descartaron filas. */
  readonly discarded: Partial<Record<TableName, string[]>>;
}

const MAX_LOGGED_PER_TABLE = 20;

/** Paso `validate`: comprueba las 6 tablas de staging sin escribir nada y avisa de las filas que se descartarán. */
export class ValidateDataset {
  private readonly staging: StagingStore;
  private readonly logger: Logger;

  constructor(staging: StagingStore, logger: Logger) {
    this.staging = staging;
    this.logger = logger;
  }

  async execute({ signal }: StepContext): Promise<ValidateOutput> {
    const rows = await this.staging.readAll();
    signal.throwIfAborted();
    const { counts, discarded } = validateStaging(rows);
    for (const [table, reasons = []] of Object.entries(discarded)) {
      this.logger.warn(`${table}: ${reasons.length} fila(s) descartada(s)`);
      for (const reason of reasons.slice(0, MAX_LOGGED_PER_TABLE)) {
        this.logger.warn(`  ${reason}`);
      }
      if (reasons.length > MAX_LOGGED_PER_TABLE) {
        this.logger.warn(`  … y ${reasons.length - MAX_LOGGED_PER_TABLE} más`);
      }
    }
    return { counts, discarded: { ...discarded } };
  }
}
