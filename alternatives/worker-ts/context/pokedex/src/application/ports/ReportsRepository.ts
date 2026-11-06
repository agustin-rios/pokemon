import type { LevelClassification } from '../../domain/reports/LevelClassification.ts';
import type { MonthlyCaptureGrowth } from '../../domain/reports/MonthlyCaptureGrowth.ts';
import type { TopTrainer } from '../../domain/reports/TopTrainer.ts';
import type { TypeSummary } from '../../domain/reports/TypeSummary.ts';

/**
 * Reportes ya agregados (Repository Pattern). Cada método lee una vista que crea
 * el worker (paso build_views): la agregación corre en la base de datos, nunca en la aplicación.
 */
export interface ReportsRepository {
  /** Vista `type_summary`, por nombre de tipo. */
  typeSummary(): Promise<TypeSummary[]>;

  /** Consulta A, vista `capture_monthly_growth`, por mes. */
  monthlyCaptureGrowth(): Promise<MonthlyCaptureGrowth[]>;

  /** Consulta B, vista `top_trainers_by_region`, por región y ranking. */
  topTrainersByRegion(): Promise<TopTrainer[]>;

  /** Consulta C, vista `level_classification_by_type`, por nombre de tipo. */
  levelClassificationByType(): Promise<LevelClassification[]>;
}
