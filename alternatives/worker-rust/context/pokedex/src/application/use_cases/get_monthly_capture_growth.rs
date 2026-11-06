use std::sync::Arc;

use crate::application::RepositoryError;
use crate::application::ports::ReportsRepository;
use crate::domain::MonthlyCaptureGrowth;

/// Consulta A: capturas por mes y variación porcentual vs. el mes anterior.
pub struct GetMonthlyCaptureGrowth {
    reports: Arc<dyn ReportsRepository>,
}

impl GetMonthlyCaptureGrowth {
    pub fn new(reports: Arc<dyn ReportsRepository>) -> Self {
        Self { reports }
    }

    /// # Errors
    ///
    /// Propaga los fallos del repositorio.
    pub async fn execute(&self) -> Result<Vec<MonthlyCaptureGrowth>, RepositoryError> {
        self.reports.monthly_capture_growth().await
    }
}
