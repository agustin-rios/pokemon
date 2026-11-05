import type { TopTrainer } from '../../domain/reports/TopTrainer.ts';
import type { ReportsRepository } from '../ports/ReportsRepository.ts';

/** Consulta B: los 3 entrenadores con más capturas de cada región. */
export class GetTopTrainersByRegion {
  private readonly reports: ReportsRepository;

  constructor(reports: ReportsRepository) {
    this.reports = reports;
  }

  execute(): Promise<TopTrainer[]> {
    return this.reports.topTrainersByRegion();
  }
}
