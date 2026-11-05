import type { LevelClassification } from '../../domain/reports/LevelClassification.ts';
import type { ReportsRepository } from '../ports/ReportsRepository.ts';

/** Consulta C: por tipo, capturas con nivel ≥ 50 y su porcentaje. */
export class GetLevelClassificationByType {
  private readonly reports: ReportsRepository;

  constructor(reports: ReportsRepository) {
    this.reports = reports;
  }

  execute(): Promise<LevelClassification[]> {
    return this.reports.levelClassificationByType();
  }
}
