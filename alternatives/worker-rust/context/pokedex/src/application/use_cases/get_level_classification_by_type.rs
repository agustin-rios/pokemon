use std::sync::Arc;

use crate::application::RepositoryError;
use crate::application::ports::ReportsRepository;
use crate::domain::LevelClassification;

/// Consulta C: por tipo, capturas con nivel ≥ 50 y su porcentaje.
pub struct GetLevelClassificationByType {
    reports: Arc<dyn ReportsRepository>,
}

impl GetLevelClassificationByType {
    pub fn new(reports: Arc<dyn ReportsRepository>) -> Self {
        Self { reports }
    }

    /// # Errors
    ///
    /// Propaga los fallos del repositorio.
    pub async fn execute(&self) -> Result<Vec<LevelClassification>, RepositoryError> {
        self.reports.level_classification_by_type().await
    }
}
