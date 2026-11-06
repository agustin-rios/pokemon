use thiserror::Error;
use uuid::Uuid;

use crate::domain::StorageError;

/// No se pudo encolar una corrida (la API lo traduce a 500).
#[derive(Debug, Error)]
pub enum EnqueueError {
    #[error("no se pudo encolar la corrida tras 3 intentos")]
    Exhausted,
    #[error(transparent)]
    Storage(#[from] StorageError),
}

/// No se pudo consultar una corrida.
#[derive(Debug, Error)]
pub enum GetRunError {
    #[error("No existe la corrida {0}")]
    NotFound(Uuid),
    #[error(transparent)]
    Storage(#[from] StorageError),
}

/// No se pudo reintentar una corrida.
#[derive(Debug, Error)]
pub enum RetryError {
    #[error("No existe la corrida {0}")]
    NotFound(Uuid),
    #[error("Solo se puede reintentar una corrida fallida")]
    NotFailed,
    #[error("Ya hay una corrida en curso")]
    AlreadyActive,
    #[error(transparent)]
    Storage(#[from] StorageError),
}
