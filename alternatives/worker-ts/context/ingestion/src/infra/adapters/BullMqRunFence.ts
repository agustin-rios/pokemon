import type { Job } from 'bullmq';
import type { RunFence } from '../../application/ports/RunFence.ts';
import { FenceLostError } from '../../domain/index.ts';

/**
 * El cerco sobre el lock del job: la ejecución es dueña de la corrida mientras el lock
 * de Redis lleve su token. `extendLock` lo comprueba y lo renueva en un solo paso
 * atómico (devuelve 1, o 0 si el lock venció o lo tiene otro), así que se consulta
 * dentro de la transacción, justo antes de confirmar.
 */
export class BullMqRunFence implements RunFence {
  private readonly job: Job;
  private readonly token: string;
  private readonly lockDurationMs: number;

  constructor(job: Job, token: string, lockDurationMs: number) {
    this.job = job;
    this.token = token;
    this.lockDurationMs = lockDurationMs;
  }

  async assertOwned(): Promise<void> {
    const extended = await this.job.extendLock(this.token, this.lockDurationMs);
    if (extended !== 1) throw new FenceLostError();
  }
}
