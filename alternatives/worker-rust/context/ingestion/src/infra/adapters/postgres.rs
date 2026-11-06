//! Utilidades comunes de los adaptadores de Postgres.

use crate::domain::StorageError;

/// Convierte un error de sqlx en `StorageError` conservando el SQLSTATE.
pub fn storage_error(error: sqlx::Error) -> StorageError {
    StorageError {
        sqlstate: error
            .as_database_error()
            .and_then(|e| e.code())
            .map(|code| code.into_owned()),
        source: Box::new(error),
    }
}
