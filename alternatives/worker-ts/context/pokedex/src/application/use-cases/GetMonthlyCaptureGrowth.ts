import type { MonthlyCaptureGrowth } from '../../domain/reports/MonthlyCaptureGrowth.ts';
import type { ReportsRepository } from '../ports/ReportsRepository.ts';

/** Consulta A: capturas por mes y variación porcentual vs. el mes anterior. */
export class GetMonthlyCaptureGrowth {
  private readonly reports: ReportsRepository;

  constructor(reports: ReportsRepository) {
    this.reports = reports;
  }

  execute(): Promise<MonthlyCaptureGrowth[]> {
    return this.reports.monthlyCaptureGrowth();
  }
}
