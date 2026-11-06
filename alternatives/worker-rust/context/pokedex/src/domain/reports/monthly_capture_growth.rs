use serde::Serialize;
use ts_rs::TS;

/// Consulta A (crecimiento mensual): capturas por mes y su variación
/// porcentual respecto del mes anterior. Vista `capture_monthly_growth`.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct MonthlyCaptureGrowth {
    /// "YYYY-MM".
    pub month: String,
    pub captures: i32,
    /// % de cambio vs. el mes anterior, con 2 decimales; null en el primer mes.
    pub change_percent: Option<f64>,
}
