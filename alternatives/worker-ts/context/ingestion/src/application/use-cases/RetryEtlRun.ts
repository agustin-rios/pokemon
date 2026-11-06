import { isRunId, type EtlRun } from '../../domain/index.ts';
import { ValidationError } from '../errors.ts';
import type { RunQueue } from '../ports/RunQueue.ts';

/**
 * Vuelve a encolar una corrida fallida: retoma desde el paso que falló. La cola lanza
 * RunNotFoundError (404) o RunConflictError (409) según el caso.
 */
export class RetryEtlRun {
  private readonly queue: RunQueue;

  constructor(queue: RunQueue) {
    this.queue = queue;
  }

  execute(runId: string): Promise<EtlRun> {
    if (!isRunId(runId)) throw new ValidationError('runId debe ser un UUID');
    return this.queue.retry(runId);
  }
}
