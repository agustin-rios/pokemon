import type { TypeSummary } from '../../domain/reports/TypeSummary.ts';
import type { ReportsRepository } from '../ports/ReportsRepository.ts';

/** GET /items/summary: Pokémon y experiencia base promedio por tipo. */
export class GetTypeSummary {
  private readonly reports: ReportsRepository;

  constructor(reports: ReportsRepository) {
    this.reports = reports;
  }

  execute(): Promise<TypeSummary[]> {
    return this.reports.typeSummary();
  }
}
