import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConfigModule, type Env } from './config/index.ts';
import { DatabaseModule } from './modules/database/database.module.ts';
import { EtlModule } from './modules/etl/etl.module.ts';
import { HealthModule } from './modules/health/health.module.ts';
import { ItemsModule } from './modules/items/items.module.ts';
import { ReportsModule } from './modules/reports/reports.module.ts';

@Module({
  imports: [
    ConfigModule,
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        connection: { url: config.get('REDIS_URL', { infer: true }) },
      }),
    }),
    DatabaseModule,
    EtlModule,
    HealthModule,
    ItemsModule,
    ReportsModule,
  ],
})
export class AppModule {}
