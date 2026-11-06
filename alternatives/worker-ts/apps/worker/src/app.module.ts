import { Module } from '@nestjs/common';
import { ConfigModule } from './config/index.ts';
import { DatabaseModule } from './modules/database/database.module.ts';
import { EtlModule } from './modules/etl/etl.module.ts';

@Module({
  imports: [ConfigModule, DatabaseModule, EtlModule],
})
export class AppModule {}
