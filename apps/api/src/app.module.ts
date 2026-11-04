import { Module } from '@nestjs/common';
import { ConfigModule } from './config/index.ts';
import { HealthModule } from './modules/health/health.module.ts';

@Module({
  imports: [ConfigModule, HealthModule],
})
export class AppModule {}
