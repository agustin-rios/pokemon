import { Module } from '@nestjs/common';
import {
  GetLevelClassificationByType,
  GetMonthlyCaptureGrowth,
  GetTopTrainersByRegion,
} from '@pokemon/context-pokedex';
import { provideUseCase } from '../../common/helpers/nest-provider.helper.ts';
import {
  PokedexRepositoriesModule,
  REPORTS_REPOSITORY,
} from '../pokedex/pokedex-repositories.module.ts';
import { ReportsController } from './reports.controller.ts';

@Module({
  imports: [PokedexRepositoriesModule],
  providers: [
    provideUseCase(GetMonthlyCaptureGrowth, [REPORTS_REPOSITORY]),
    provideUseCase(GetTopTrainersByRegion, [REPORTS_REPOSITORY]),
    provideUseCase(GetLevelClassificationByType, [REPORTS_REPOSITORY]),
  ],
  controllers: [ReportsController],
})
export class ReportsModule {}
