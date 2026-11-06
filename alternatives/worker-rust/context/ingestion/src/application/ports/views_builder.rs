use async_trait::async_trait;

use crate::domain::StorageError;

/// Crea o actualiza las vistas de reportes.
#[async_trait]
pub trait ViewsBuilder: Send + Sync {
    async fn build(&self) -> Result<(), StorageError>;
}
