use std::time::Duration;

use async_trait::async_trait;
use sqlx::PgPool;

use super::pg_transaction::{DEFAULT_STATEMENT_TIMEOUT, begin, still_owner};
use super::storage_error;
use crate::application::ports::{CommitOutcome, DatasetLoader, Fence};
use crate::domain::{StorageError, ValidationReport};

/// Carga las tablas finales desde `staging` en una sola transacción: `TRUNCATE` y un
/// `INSERT ... SELECT` por tabla en orden de FK, todo dentro de la base.
pub struct PgDatasetLoader {
    pool: PgPool,
    statement_timeout: Duration,
}

impl PgDatasetLoader {
    pub fn new(pool: PgPool) -> Self {
        Self {
            pool,
            statement_timeout: DEFAULT_STATEMENT_TIMEOUT,
        }
    }

    /// Cambia el plazo de cada sentencia (por defecto 60 s).
    #[must_use]
    pub fn with_statement_timeout(mut self, statement_timeout: Duration) -> Self {
        self.statement_timeout = statement_timeout;
        self
    }
}

#[async_trait]
impl DatasetLoader for PgDatasetLoader {
    async fn load(
        &self,
        report: &ValidationReport,
        fence: Option<&Fence>,
    ) -> Result<CommitOutcome, StorageError> {
        let mut tx = begin(&self.pool, self.statement_timeout).await?;
        sqlx::query(
            "TRUNCATE public.types, public.pokemon, public.pokemon_types, \
             public.trainers, public.captures, public.battles",
        )
        .execute(&mut *tx)
        .await
        .map_err(storage_error)?;

        // La base es la dueña de los datos: nada pasa por el worker.
        for sql in [
            "INSERT INTO public.types (id, name) SELECT id, name FROM staging.types ORDER BY id",
            "INSERT INTO public.pokemon (id, name, height, weight, base_experience, sprite_url) \
             SELECT id, name, height, weight, coalesce(base_experience, 0), sprite_url \
             FROM staging.pokemon ORDER BY id",
            "INSERT INTO public.pokemon_types (pokemon_id, type_id, slot) \
             SELECT pokemon_id, type_id, slot FROM staging.pokemon_types ORDER BY pokemon_id, type_id",
            "INSERT INTO public.trainers (id, name, region, created_at) \
             SELECT id, name, region, created_at FROM staging.trainers ORDER BY id",
        ] {
            sqlx::query(sql)
                .execute(&mut *tx)
                .await
                .map_err(storage_error)?;
        }
        sqlx::query(
            "INSERT INTO public.captures (id, trainer_id, pokemon_id, captured_at, level, location) \
             SELECT id, trainer_id, pokemon_id, captured_at, level, location \
             FROM staging.captures WHERE id <> ALL($1::int4[]) ORDER BY id",
        )
        .bind(&report.discarded_captures)
        .execute(&mut *tx)
        .await
        .map_err(storage_error)?;
        sqlx::query(
            "INSERT INTO public.battles \
             (id, pokemon_a_id, pokemon_b_id, winner_id, fought_at, duration_seconds) \
             SELECT id, pokemon_a_id, pokemon_b_id, winner_id, fought_at, duration_seconds \
             FROM staging.battles WHERE id <> ALL($1::int4[]) ORDER BY id",
        )
        .bind(&report.discarded_battles)
        .execute(&mut *tx)
        .await
        .map_err(storage_error)?;

        if !still_owner(&mut tx, fence).await? {
            tx.rollback().await.map_err(storage_error)?;
            return Ok(CommitOutcome::LeaseLost);
        }
        tx.commit().await.map_err(storage_error)?;
        Ok(CommitOutcome::Committed)
    }
}
