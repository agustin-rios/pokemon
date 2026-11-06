import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import {
  EnqueueEtlRun,
  GetEtlRun,
  RetryEtlRun,
} from '@pokemon/context-ingestion';
import {
  BullMqEtlRunQueue,
  ETL_QUEUE,
} from '@pokemon/context-ingestion/adapters';
import type { Queue } from 'bullmq';
import { provideUseCase } from '../../common/helpers/nest-provider.helper.ts';
import { EtlController } from './etl.controller.ts';

/** Token del puerto RunQueue del contexto ingestion. */
export const RUN_QUEUE = 'RUN_QUEUE';

@Module({
  imports: [BullModule.registerQueue({ name: ETL_QUEUE })],
  providers: [
    {
      provide: RUN_QUEUE,
      inject: [getQueueToken(ETL_QUEUE)],
      useFactory: (queue: Queue) => new BullMqEtlRunQueue(queue),
    },
    provideUseCase(EnqueueEtlRun, [RUN_QUEUE]),
    provideUseCase(GetEtlRun, [RUN_QUEUE]),
    provideUseCase(RetryEtlRun, [RUN_QUEUE]),
  ],
  controllers: [EtlController],
})
export class EtlModule {}
