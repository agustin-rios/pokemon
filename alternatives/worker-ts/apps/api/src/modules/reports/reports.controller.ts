import { Controller, Get, Inject } from '@nestjs/common';
import {
  GetLevelClassificationByType,
  GetMonthlyCaptureGrowth,
  GetTopTrainersByRegion,
  type LevelClassification,
  type MonthlyCaptureGrowth,
  type TopTrainer,
} from '@pokemon/context-pokedex';

/** Consultas A, B y C: cada una lee su vista en la base (la agregación corre en Postgres). */
@Controller('reports')
export class ReportsController {
  constructor(
    @Inject(GetMonthlyCaptureGrowth)
    private readonly getMonthlyCaptureGrowth: GetMonthlyCaptureGrowth,
    @Inject(GetTopTrainersByRegion)
    private readonly getTopTrainersByRegion: GetTopTrainersByRegion,
    @Inject(GetLevelClassificationByType)
    private readonly getLevelClassificationByType: GetLevelClassificationByType,
  ) {}

  /** Consulta A: capturas por mes y % de cambio vs. el mes anterior. */
  @Get('monthly-growth')
  monthlyGrowth(): Promise<MonthlyCaptureGrowth[]> {
    return this.getMonthlyCaptureGrowth.execute();
  }

  /** Consulta B: los 3 entrenadores con más capturas de cada región. */
  @Get('top-trainers')
  topTrainers(): Promise<TopTrainer[]> {
    return this.getTopTrainersByRegion.execute();
  }

  /** Consulta C: por tipo, capturas con nivel ≥ 50 y su porcentaje. */
  @Get('level-classification')
  levelClassification(): Promise<LevelClassification[]> {
    return this.getLevelClassificationByType.execute();
  }
}
