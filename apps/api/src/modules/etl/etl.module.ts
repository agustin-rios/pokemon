import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/index.ts';
import { AirflowClient } from './airflow.client.ts';
import { EtlController } from './etl.controller.ts';

@Module({
  providers: [
    {
      provide: AirflowClient,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new AirflowClient({
          url: config.get('AIRFLOW_URL', { infer: true }),
          username: config.get('AIRFLOW_USERNAME', { infer: true }),
          password: config.get('AIRFLOW_PASSWORD', { infer: true }),
        }),
    },
  ],
  controllers: [EtlController],
})
export class EtlModule {}
