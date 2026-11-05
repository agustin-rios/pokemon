import type { PrismaClient } from '@pokemon/db-main';

import type { LevelClassification } from '../../domain/reports/LevelClassification.ts';
import type { MonthlyCaptureGrowth } from '../../domain/reports/MonthlyCaptureGrowth.ts';
import type { TopTrainer } from '../../domain/reports/TopTrainer.ts';
import type { TypeSummary } from '../../domain/reports/TypeSummary.ts';
import type { ReportsRepository } from '../../application/ports/ReportsRepository.ts';

export class PrismaReportsRepository implements ReportsRepository {
  private readonly prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  async typeSummary(): Promise<TypeSummary[]> {
    return this.prisma.$queryRaw<TypeSummary[]>`
      SELECT
        type_id AS "typeId",
        type_name AS "typeName",
        pokemon_count::int AS "pokemonCount",
        avg_base_experience::float8 AS "averageBaseExperience"
      FROM type_summary
      ORDER BY type_name
    `;
  }

  async monthlyCaptureGrowth(): Promise<MonthlyCaptureGrowth[]> {
    return this.prisma.$queryRaw<MonthlyCaptureGrowth[]>`
      SELECT
        to_char(month, 'YYYY-MM') AS month,
        captures::int AS captures,
        pct_change::float8 AS "changePercent"
      FROM capture_monthly_growth
      ORDER BY month
    `;
  }

  async topTrainersByRegion(): Promise<TopTrainer[]> {
    return this.prisma.$queryRaw<TopTrainer[]>`
      SELECT
        region,
        rank::int AS rank,
        trainer_id AS "trainerId",
        trainer_name AS "trainerName",
        captures::int AS captures
      FROM top_trainers_by_region
      ORDER BY region, rank
    `;
  }

  async levelClassificationByType(): Promise<LevelClassification[]> {
    return this.prisma.$queryRaw<LevelClassification[]>`
      SELECT
        type_id AS "typeId",
        type_name AS "typeName",
        total_captures::int AS "totalCaptures",
        high_level_captures::int AS "highLevelCaptures",
        high_level_pct::float8 AS "highLevelPercent"
      FROM level_classification_by_type
      ORDER BY type_name
    `;
  }
}