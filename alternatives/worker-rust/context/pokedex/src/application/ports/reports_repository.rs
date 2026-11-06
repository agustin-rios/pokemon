use async_trait::async_trait;

use crate::application::RepositoryError;
use crate::domain::{LevelClassification, MonthlyCaptureGrowth, TopTrainer, TypeSummary};

/// Reportes ya agregados (Repository Pattern). Cada método lee una vista que
/// crea el pipeline: la agregación corre en la base de datos, nunca en la
/// aplicación.
#[async_trait]
pub trait ReportsRepository: Send + Sync {
    /// Vista `type_summary`, por nombre de tipo.
    async fn type_summary(&self) -> Result<Vec<TypeSummary>, RepositoryError>;

    /// Consulta A, vista `capture_monthly_growth`, por mes.
    async fn monthly_capture_growth(&self) -> Result<Vec<MonthlyCaptureGrowth>, RepositoryError>;

    /// Consulta B, vista `top_trainers_by_region`, por región y ranking.
    async fn top_trainers_by_region(&self) -> Result<Vec<TopTrainer>, RepositoryError>;

    /// Consulta C, vista `level_classification_by_type`, por nombre de tipo.
    async fn level_classification_by_type(
        &self,
    ) -> Result<Vec<LevelClassification>, RepositoryError>;
}
