//! Utilidades comunes de los adaptadores de Postgres.

use pokemon_context_ingestion::infra::adapters::storage_error;

#[test]
fn storage_error_of_a_non_database_error_has_no_sqlstate() {
    let error = storage_error(sqlx::Error::PoolTimedOut);

    assert_eq!(error.sqlstate, None);
}
