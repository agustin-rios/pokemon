//! Adaptadores sqlx (Postgres) de los puertos del contexto.

mod pg_pokemon_repository;
mod pg_reports_repository;

pub use pg_pokemon_repository::PgPokemonRepository;
pub use pg_reports_repository::PgReportsRepository;

use crate::application::RepositoryError;

/// SQLSTATE de "relación inexistente": la tabla o vista aún no se creó.
const UNDEFINED_TABLE: &str = "42P01";

/// Traduce un error de sqlx; una relación inexistente se distingue para que la
/// API responda 503 en vez de 500.
fn map_error(error: sqlx::Error) -> RepositoryError {
    match &error {
        sqlx::Error::Database(db) if db.code().as_deref() == Some(UNDEFINED_TABLE) => {
            RepositoryError::DataNotLoaded
        }
        _ => RepositoryError::Storage(Box::new(error)),
    }
}
