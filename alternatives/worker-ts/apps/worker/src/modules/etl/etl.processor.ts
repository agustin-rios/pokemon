import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger, type BeforeApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ExecuteEtlRun } from '@pokemon/context-ingestion';
import {
  BullMqRunFence,
  BullMqRunProgress,
  ETL_QUEUE,
} from '@pokemon/context-ingestion/adapters';
import { UnrecoverableError, WaitingError, type Job } from 'bullmq';
import { lockDurationMs, type Env } from '../../config/index.ts';

/**
 * Consume la cola `etl`: una corrida a la vez. El job es la corrida; su progreso guarda el
 * estado de los pasos, y su lock en Redis es el cerco que cada paso consulta antes de
 * confirmar sus escrituras.
 *
 * - Fallo permanente: UnrecoverableError (BullMQ no lo reintenta).
 * - Fallo reintentable: Error normal (BullMQ reintenta con backoff).
 * - Detenida sin terminar (apagado, o se perdió el lock): vuelve a la cola sin gastar un intento.
 */
@Processor(ETL_QUEUE, {
  concurrency: 1,
  lockDuration: lockDurationMs,
  maxStalledCount: 1,
})
export class EtlProcessor
  extends WorkerHost
  implements BeforeApplicationShutdown
{
  private readonly logger = new Logger(EtlProcessor.name);
  private readonly shutdown = new AbortController();

  constructor(
    @Inject(ExecuteEtlRun) private readonly executeEtlRun: ExecuteEtlRun,
    @Inject(ConfigService) private readonly config: ConfigService<Env, true>,
  ) {
    super();
  }

  async process(job: Job, token?: string): Promise<null> {
    if (!token) throw new Error('BullMQ no entregó el token del lock del job');

    const outcome = await this.executeEtlRun.execute({
      runId: job.id ?? '',
      progress: new BullMqRunProgress(job),
      fence: new BullMqRunFence(
        job,
        token,
        this.config.get('LOCK_DURATION_MS', { infer: true }),
      ),
      shutdown: this.shutdown.signal,
    });

    switch (outcome.status) {
      case 'succeeded':
        return null;
      case 'failed':
        if (outcome.errorClass === 'permanent') {
          throw new UnrecoverableError(outcome.message);
        }
        throw new Error(outcome.message, { cause: outcome.cause });
      case 'stopped':
        this.logger.warn(
          `Corrida ${job.id}: detenida sin terminar (${outcome.reason}); vuelve a la cola`,
        );
        await job.moveToWait(token);
        throw new WaitingError();
    }
  }

  /**
   * SIGTERM/SIGINT: ExecuteEtlRun termina el paso en curso (o lo cancela pasada la gracia) y
   * no empieza otro. Se espera aquí al worker, antes de que DatabaseModule desconecte Prisma:
   * `worker.close()` no vuelve hasta que el job activo termina.
   */
  async beforeApplicationShutdown(): Promise<void> {
    this.logger.log(
      'Apagado pedido: se termina el paso en curso y se cierra el worker',
    );
    this.shutdown.abort();
    await this.worker.close();
  }
}
