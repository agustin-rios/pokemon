use async_trait::async_trait;
use pokemon_data::dataset::Dataset;
use pokemon_data::generator::Generated;

use super::commit_outcome::CommitOutcome;
use super::fence::Fence;
use crate::domain::{StagingDataset, StorageError};

/// Las tablas de `staging`: los datos de una corrida entre un paso y el siguiente.
#[async_trait]
pub trait StagingStore: Send + Sync {
    /// Reemplaza `staging.types`, `staging.pokemon` y `staging.pokemon_types` con
    /// `catalog` en una transacción. Con `fence`, antes del commit verifica que la
    /// corrida siga siendo de este worker; si no, hace rollback.
    async fn replace_catalog(
        &self,
        catalog: &Dataset,
        fence: Option<&Fence>,
    ) -> Result<CommitOutcome, StorageError>;

    /// Reemplaza `staging.trainers`, `staging.captures` y `staging.battles` con
    /// `generated` en una transacción, con el mismo fence.
    async fn replace_generated(
        &self,
        generated: &Generated,
        fence: Option<&Fence>,
    ) -> Result<CommitOutcome, StorageError>;

    /// Ids distintos de `staging.pokemon`, ascendentes.
    async fn pokemon_ids(&self) -> Result<Vec<i32>, StorageError>;

    /// Las 6 tablas completas, ordenadas por `id` (`pokemon_types` por
    /// `pokemon_id, type_id`) con los nulos al final.
    async fn read_all(&self) -> Result<StagingDataset, StorageError>;
}
