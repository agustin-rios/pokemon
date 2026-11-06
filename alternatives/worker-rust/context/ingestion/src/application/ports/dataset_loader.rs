use async_trait::async_trait;

use super::commit_outcome::CommitOutcome;
use super::fence::Fence;
use crate::domain::{StorageError, ValidationReport};

/// Carga las 6 tablas de la base principal desde `staging`.
#[async_trait]
pub trait DatasetLoader: Send + Sync {
    /// Reemplaza el contenido de las 6 tablas finales con el de `staging`, sin las
    /// capturas y combates que `report` descarta, en una sola transacción: ante
    /// cualquier error los datos anteriores quedan intactos. Con `fence`, antes
    /// del commit verifica que la corrida siga siendo de este worker.
    async fn load(
        &self,
        report: &ValidationReport,
        fence: Option<&Fence>,
    ) -> Result<CommitOutcome, StorageError>;
}
