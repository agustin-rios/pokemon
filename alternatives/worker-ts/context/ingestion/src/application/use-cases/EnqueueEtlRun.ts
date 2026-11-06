import type { EtlRun } from '../../domain/index.ts';
import type { RunQueue } from '../ports/RunQueue.ts';

/** Encola una corrida, o devuelve la que ya está en cola o corriendo (solo hay una activa). */
export class EnqueueEtlRun {
  private readonly queue: RunQueue;

  constructor(queue: RunQueue) {
    this.queue = queue;
  }

  execute(): Promise<EtlRun> {
    return this.queue.enqueue();
  }
}
