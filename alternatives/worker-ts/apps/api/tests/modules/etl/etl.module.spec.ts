import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import {
  EnqueueEtlRun,
  GetEtlRun,
  RetryEtlRun,
} from '@pokemon/context-ingestion';
import { ETL_QUEUE } from '@pokemon/context-ingestion/adapters';
import { EtlModule } from '../../../src/modules/etl/etl.module.ts';

describe('EtlModule', () => {
  it('registra la cola etl y arma los casos de uso sobre ella', async () => {
    const queue = { getJob: vi.fn().mockResolvedValue(undefined) };
    const moduleRef = await Test.createTestingModule({
      imports: [
        BullModule.forRoot({
          connection: {
            url: process.env['TEST_REDIS_URL'] ?? 'redis://localhost:6411',
          },
        }),
        EtlModule,
      ],
    })
      .overrideProvider(getQueueToken(ETL_QUEUE))
      .useValue(queue)
      .compile();

    expect(moduleRef.get(EnqueueEtlRun)).toBeInstanceOf(EnqueueEtlRun);
    expect(moduleRef.get(RetryEtlRun)).toBeInstanceOf(RetryEtlRun);
    // GetEtlRun llega hasta la cola de BullMQ: pide el job por su id.
    await expect(
      moduleRef.get(GetEtlRun).execute('3f1c9a52-7d0e-4c58-9a51-0c8f6b2d4e11'),
    ).resolves.toBeNull();
    expect(queue.getJob).toHaveBeenCalledWith(
      '3f1c9a52-7d0e-4c58-9a51-0c8f6b2d4e11',
    );
  });
});
