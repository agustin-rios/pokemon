import type { Job } from 'bullmq';
import type { RunProgress } from '../../application/ports/RunProgress.ts';
import type { EtlStep } from '../../domain/index.ts';
import { stepsOf } from './BullMqEtlRunQueue.ts';

/** El estado de los pasos, guardado en el progreso del job de BullMQ (`{ steps }`). */
export class BullMqRunProgress implements RunProgress {
  private readonly job: Job;

  constructor(job: Job) {
    this.job = job;
  }

  load(): Promise<readonly EtlStep[]> {
    return Promise.resolve(stepsOf(this.job.progress));
  }

  async save(steps: readonly EtlStep[]): Promise<void> {
    await this.job.updateProgress({ steps });
  }
}
