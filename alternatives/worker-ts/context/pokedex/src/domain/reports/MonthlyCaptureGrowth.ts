/**
 * Consulta A (crecimiento mensual): capturas por mes y su variación porcentual
 * respecto del mes anterior. Vista `capture_monthly_growth`.
 */
export interface MonthlyCaptureGrowth {
  /** "YYYY-MM". */
  readonly month: string;
  readonly captures: number;
  /** % de cambio vs. el mes anterior, con 2 decimales; null en el primer mes. */
  readonly changePercent: number | null;
}
