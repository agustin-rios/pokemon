use async_trait::async_trait;
use pokemon_db::VIEWS_SQL;
use sqlx::PgPool;

use super::storage_error;
use crate::application::ports::ViewsBuilder;
use crate::domain::StorageError;

/// Ejecuta `db/main/sql/views.sql` tal cual.
pub struct PgViewsBuilder {
    pool: PgPool,
}

impl PgViewsBuilder {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl ViewsBuilder for PgViewsBuilder {
    async fn build(&self) -> Result<(), StorageError> {
        // `raw_sql` usa el protocolo simple: acepta varias sentencias y el `;`
        // que hay dentro de un comentario del archivo no molesta.
        sqlx::raw_sql(VIEWS_SQL)
            .execute(&self.pool)
            .await
            .map(|_| ())
            .map_err(storage_error)
    }
}
