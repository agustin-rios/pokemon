use std::sync::Arc;

use crate::application::RepositoryError;
use crate::application::ports::ReportsRepository;
use crate::domain::TypeSummary;

/// `GET /items/summary`: Pokémon y experiencia base promedio por tipo.
pub struct GetTypeSummary {
    reports: Arc<dyn ReportsRepository>,
}

impl GetTypeSummary {
    pub fn new(reports: Arc<dyn ReportsRepository>) -> Self {
        Self { reports }
    }

    /// # Errors
    ///
    /// Propaga los fallos del repositorio.
    pub async fn execute(&self) -> Result<Vec<TypeSummary>, RepositoryError> {
        self.reports.type_summary().await
    }
}
