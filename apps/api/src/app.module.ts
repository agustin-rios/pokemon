import { Module } from '@nestjs/common';
import { ConfigModule } from './config/index.ts';
import { DatabaseModule } from './modules/database/database.module.ts';
import { EtlModule } from './modules/etl/etl.module.ts';
import { HealthModule } from './modules/health/health.module.ts';
import { ItemsModule } from './modules/items/items.module.ts';
import { ReportsModule } from './modules/reports/reports.module.ts';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    EtlModule,
    HealthModule,
    ItemsModule,
    ReportsModule,
  ],
})
export class AppModule {}
