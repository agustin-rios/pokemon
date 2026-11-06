use std::time::Duration;

use async_trait::async_trait;
use chrono::{NaiveDate, NaiveDateTime};
use pokemon_data::dataset::Dataset;
use pokemon_data::generator::Generated;
use sqlx::PgPool;

use super::pg_transaction::{DEFAULT_STATEMENT_TIMEOUT, begin, still_owner};
use super::storage_error;
use crate::application::ports::{CommitOutcome, Fence, StagingStore};
use crate::domain::{
    BattleRecord, CaptureRecord, PokemonRecord, PokemonTypeRecord, StagingDataset, StorageError,
    TrainerRecord, TypeRecord,
};

/// Tablas `staging.*` de Postgres. Cada reemplazo es una transacción: `TRUNCATE` de sus
/// tres tablas, inserción masiva con `UNNEST` y verificación del fence antes del commit.
pub struct PgStagingStore {
    pool: PgPool,
    statement_timeout: Duration,
}

impl PgStagingStore {
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
impl StagingStore for PgStagingStore {
    async fn replace_catalog(
        &self,
        catalog: &Dataset,
        fence: Option<&Fence>,
    ) -> Result<CommitOutcome, StorageError> {
        let mut tx = begin(&self.pool, self.statement_timeout).await?;
        sqlx::query("TRUNCATE staging.types, staging.pokemon, staging.pokemon_types")
            .execute(&mut *tx)
            .await
            .map_err(storage_error)?;

        sqlx::query(
            "INSERT INTO staging.types (id, name) SELECT * FROM UNNEST($1::int4[], $2::text[])",
        )
        .bind(catalog.types.iter().map(|r| r.id).collect::<Vec<_>>())
        .bind(
            catalog
                .types
                .iter()
                .map(|r| r.name.as_str())
                .collect::<Vec<_>>(),
        )
        .execute(&mut *tx)
        .await
        .map_err(storage_error)?;

        sqlx::query(
            "INSERT INTO staging.pokemon (id, name, height, weight, base_experience, sprite_url) \
             SELECT * FROM UNNEST($1::int4[], $2::text[], $3::int4[], $4::int4[], $5::int4[], $6::text[])",
        )
        .bind(catalog.pokemon.iter().map(|r| r.id).collect::<Vec<_>>())
        .bind(catalog.pokemon.iter().map(|r| r.name.as_str()).collect::<Vec<_>>())
        .bind(catalog.pokemon.iter().map(|r| r.height).collect::<Vec<_>>())
        .bind(catalog.pokemon.iter().map(|r| r.weight).collect::<Vec<_>>())
        .bind(catalog.pokemon.iter().map(|r| r.base_experience).collect::<Vec<_>>())
        .bind(catalog.pokemon.iter().map(|r| r.sprite.as_deref()).collect::<Vec<_>>())
        .execute(&mut *tx)
        .await
        .map_err(storage_error)?;

        sqlx::query(
            "INSERT INTO staging.pokemon_types (pokemon_id, type_id, slot) \
             SELECT pokemon_id, type_id, slot::smallint \
             FROM UNNEST($1::int4[], $2::int4[], $3::int4[]) AS t(pokemon_id, type_id, slot)",
        )
        .bind(
            catalog
                .pokemon_types
                .iter()
                .map(|r| r.pokemon_id)
                .collect::<Vec<_>>(),
        )
        .bind(
            catalog
                .pokemon_types
                .iter()
                .map(|r| r.type_id)
                .collect::<Vec<_>>(),
        )
        .bind(
            catalog
                .pokemon_types
                .iter()
                .map(|r| r.slot)
                .collect::<Vec<_>>(),
        )
        .execute(&mut *tx)
        .await
        .map_err(storage_error)?;

        commit_if_owner(tx, fence).await
    }

    async fn replace_generated(
        &self,
        generated: &Generated,
        fence: Option<&Fence>,
    ) -> Result<CommitOutcome, StorageError> {
        let mut tx = begin(&self.pool, self.statement_timeout).await?;
        sqlx::query("TRUNCATE staging.trainers, staging.captures, staging.battles")
            .execute(&mut *tx)
            .await
            .map_err(storage_error)?;

        sqlx::query(
            "INSERT INTO staging.trainers (id, name, region, created_at) \
             SELECT * FROM UNNEST($1::int4[], $2::text[], $3::text[], $4::date[])",
        )
        .bind(generated.trainers.iter().map(|r| r.id).collect::<Vec<_>>())
        .bind(
            generated
                .trainers
                .iter()
                .map(|r| r.name.as_str())
                .collect::<Vec<_>>(),
        )
        .bind(
            generated
                .trainers
                .iter()
                .map(|r| r.region)
                .collect::<Vec<_>>(),
        )
        .bind(
            generated
                .trainers
                .iter()
                .map(|r| r.created_at)
                .collect::<Vec<NaiveDate>>(),
        )
        .execute(&mut *tx)
        .await
        .map_err(storage_error)?;

        sqlx::query(
            "INSERT INTO staging.captures (id, trainer_id, pokemon_id, captured_at, level, location) \
             SELECT * FROM UNNEST($1::int4[], $2::int4[], $3::int4[], $4::timestamp[], $5::int4[], $6::text[])",
        )
        .bind(generated.captures.iter().map(|r| r.id).collect::<Vec<_>>())
        .bind(generated.captures.iter().map(|r| r.trainer_id).collect::<Vec<_>>())
        .bind(generated.captures.iter().map(|r| r.pokemon_id).collect::<Vec<_>>())
        .bind(generated.captures.iter().map(|r| r.captured_at).collect::<Vec<NaiveDateTime>>())
        .bind(generated.captures.iter().map(|r| r.level).collect::<Vec<_>>())
        .bind(generated.captures.iter().map(|r| r.location).collect::<Vec<_>>())
        .execute(&mut *tx)
        .await
        .map_err(storage_error)?;

        sqlx::query(
            "INSERT INTO staging.battles \
             (id, pokemon_a_id, pokemon_b_id, winner_id, fought_at, duration_seconds) \
             SELECT * FROM UNNEST($1::int4[], $2::int4[], $3::int4[], $4::int4[], $5::timestamp[], $6::int4[])",
        )
        .bind(generated.battles.iter().map(|r| r.id).collect::<Vec<_>>())
        .bind(generated.battles.iter().map(|r| r.pokemon_a_id).collect::<Vec<_>>())
        .bind(generated.battles.iter().map(|r| r.pokemon_b_id).collect::<Vec<_>>())
        .bind(generated.battles.iter().map(|r| r.winner_id).collect::<Vec<_>>())
        .bind(generated.battles.iter().map(|r| r.fought_at).collect::<Vec<NaiveDateTime>>())
        .bind(generated.battles.iter().map(|r| r.duration_seconds).collect::<Vec<_>>())
        .execute(&mut *tx)
        .await
        .map_err(storage_error)?;

        commit_if_owner(tx, fence).await
    }

    async fn pokemon_ids(&self) -> Result<Vec<i32>, StorageError> {
        let mut tx = begin(&self.pool, self.statement_timeout).await?;
        sqlx::query_scalar(
            "SELECT DISTINCT id FROM staging.pokemon WHERE id IS NOT NULL ORDER BY id",
        )
        .fetch_all(&mut *tx)
        .await
        .map_err(storage_error)
    }

    async fn read_all(&self) -> Result<StagingDataset, StorageError> {
        let mut tx = begin(&self.pool, self.statement_timeout).await?;
        // `ctid` desempata ids repetidos con el orden de inserción; los nulos van al final.
        let types = sqlx::query_as::<_, (Option<i32>, Option<String>)>(
            "SELECT id, name FROM staging.types ORDER BY id, ctid",
        )
        .fetch_all(&mut *tx)
        .await
        .map_err(storage_error)?;
        let pokemon = sqlx::query_as::<
            _,
            (
                Option<i32>,
                Option<String>,
                Option<i32>,
                Option<i32>,
                Option<i32>,
                Option<String>,
            ),
        >(
            "SELECT id, name, height, weight, base_experience, sprite_url \
             FROM staging.pokemon ORDER BY id, ctid",
        )
        .fetch_all(&mut *tx)
        .await
        .map_err(storage_error)?;
        let pokemon_types = sqlx::query_as::<_, (Option<i32>, Option<i32>, Option<i16>)>(
            "SELECT pokemon_id, type_id, slot FROM staging.pokemon_types \
             ORDER BY pokemon_id, type_id, ctid",
        )
        .fetch_all(&mut *tx)
        .await
        .map_err(storage_error)?;
        let trainers = sqlx::query_as::<
            _,
            (
                Option<i32>,
                Option<String>,
                Option<String>,
                Option<NaiveDate>,
            ),
        >(
            "SELECT id, name, region, created_at FROM staging.trainers ORDER BY id, ctid",
        )
        .fetch_all(&mut *tx)
        .await
        .map_err(storage_error)?;
        let captures = sqlx::query_as::<
            _,
            (
                Option<i32>,
                Option<i32>,
                Option<i32>,
                Option<NaiveDateTime>,
                Option<i32>,
                Option<String>,
            ),
        >(
            "SELECT id, trainer_id, pokemon_id, captured_at, level, location \
             FROM staging.captures ORDER BY id, ctid",
        )
        .fetch_all(&mut *tx)
        .await
        .map_err(storage_error)?;
        let battles = sqlx::query_as::<
            _,
            (
                Option<i32>,
                Option<i32>,
                Option<i32>,
                Option<i32>,
                Option<NaiveDateTime>,
                Option<i32>,
            ),
        >(
            "SELECT id, pokemon_a_id, pokemon_b_id, winner_id, fought_at, duration_seconds \
             FROM staging.battles ORDER BY id, ctid",
        )
        .fetch_all(&mut *tx)
        .await
        .map_err(storage_error)?;

        Ok(StagingDataset {
            types: types
                .into_iter()
                .map(|(id, name)| TypeRecord { id, name })
                .collect(),
            pokemon: pokemon
                .into_iter()
                .map(
                    |(id, name, height, weight, base_experience, sprite_url)| PokemonRecord {
                        id,
                        name,
                        height,
                        weight,
                        base_experience,
                        sprite_url,
                    },
                )
                .collect(),
            pokemon_types: pokemon_types
                .into_iter()
                .map(|(pokemon_id, type_id, slot)| PokemonTypeRecord {
                    pokemon_id,
                    type_id,
                    slot: slot.map(i32::from),
                })
                .collect(),
            trainers: trainers
                .into_iter()
                .map(|(id, name, region, created_at)| TrainerRecord {
                    id,
                    name,
                    region,
                    created_at,
                })
                .collect(),
            captures: captures
                .into_iter()
                .map(
                    |(id, trainer_id, pokemon_id, captured_at, level, location)| CaptureRecord {
                        id,
                        trainer_id,
                        pokemon_id,
                        captured_at,
                        level,
                        location,
                    },
                )
                .collect(),
            battles: battles
                .into_iter()
                .map(
                    |(id, pokemon_a_id, pokemon_b_id, winner_id, fought_at, duration_seconds)| {
                        BattleRecord {
                            id,
                            pokemon_a_id,
                            pokemon_b_id,
                            winner_id,
                            fought_at,
                            duration_seconds,
                        }
                    },
                )
                .collect(),
        })
    }
}

/// Verifica el fence y hace el commit; sin dueño, rollback.
async fn commit_if_owner(
    mut tx: sqlx::Transaction<'static, sqlx::Postgres>,
    fence: Option<&Fence>,
) -> Result<CommitOutcome, StorageError> {
    if !still_owner(&mut tx, fence).await? {
        tx.rollback().await.map_err(storage_error)?;
        return Ok(CommitOutcome::LeaseLost);
    }
    tx.commit().await.map_err(storage_error)?;
    Ok(CommitOutcome::Committed)
}
