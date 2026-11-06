use std::sync::Arc;

use crate::application::RepositoryError;
use crate::application::ports::ReportsRepository;
use crate::domain::TopTrainer;

/// Consulta B: los 3 entrenadores con más capturas de cada región.
pub struct GetTopTrainersByRegion {
    reports: Arc<dyn ReportsRepository>,
}

impl GetTopTrainersByRegion {
    pub fn new(reports: Arc<dyn ReportsRepository>) -> Self {
        Self { reports }
    }

    /// # Errors
    ///
    /// Propaga los fallos del repositorio.
    pub async fn execute(&self) -> Result<Vec<TopTrainer>, RepositoryError> {
        self.reports.top_trainers_by_region().await
    }
}
