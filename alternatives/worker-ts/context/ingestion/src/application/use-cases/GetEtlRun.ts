import { isRunId, type EtlRun } from '../../domain/index.ts';
import { ValidationError } from '../errors.ts';
import type { RunQueue } from '../ports/RunQueue.ts';

/** Una corrida con sus pasos; null si no existe (la API lo traduce a 404). */
export class GetEtlRun {
  private readonly queue: RunQueue;

  constructor(queue: RunQueue) {
    this.queue = queue;
  }

  execute(runId: string): Promise<EtlRun | null> {
    if (!isRunId(runId)) throw new ValidationError('runId debe ser un UUID');
    return this.queue.get(runId);
  }
}
