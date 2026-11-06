use async_trait::async_trait;
use sqlx::PgPool;

use super::map_error;
use crate::application::RepositoryError;
use crate::application::ports::ReportsRepository;
use crate::domain::{LevelClassification, MonthlyCaptureGrowth, TopTrainer, TypeSummary};

/// Lee las vistas de reportes. Los conteos y NUMERIC se convierten en SQL
/// (`::int`, `::float8`) para decodificarlos como `i32` y `f64`.
pub struct PgReportsRepository {
    pool: PgPool,
}

impl PgReportsRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl ReportsRepository for PgReportsRepository {
    async fn type_summary(&self) -> Result<Vec<TypeSummary>, RepositoryError> {
        let rows: Vec<(i32, String, i32, f64)> = sqlx::query_as(
            "SELECT
               type_id,
               type_name,
               pokemon_count::int,
               avg_base_experience::float8
             FROM type_summary
             ORDER BY type_name",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(map_error)?;
        Ok(rows
            .into_iter()
            .map(
                |(type_id, type_name, pokemon_count, average_base_experience)| TypeSummary {
                    type_id,
                    type_name,
                    pokemon_count,
                    average_base_experience,
                },
            )
            .collect())
    }

    async fn monthly_capture_growth(&self) -> Result<Vec<MonthlyCaptureGrowth>, RepositoryError> {
        let rows: Vec<(String, i32, Option<f64>)> = sqlx::query_as(
            "SELECT
               to_char(month, 'YYYY-MM'),
               captures::int,
               pct_change::float8
             FROM capture_monthly_growth
             ORDER BY month",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(map_error)?;
        Ok(rows
            .into_iter()
            .map(|(month, captures, change_percent)| MonthlyCaptureGrowth {
                month,
                captures,
                change_percent,
            })
            .collect())
    }

    async fn top_trainers_by_region(&self) -> Result<Vec<TopTrainer>, RepositoryError> {
        let rows: Vec<(String, i32, i32, String, i32)> = sqlx::query_as(
            "SELECT
               region,
               rank::int,
               trainer_id,
               trainer_name,
               captures::int
             FROM top_trainers_by_region
             ORDER BY region, rank",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(map_error)?;
        Ok(rows
            .into_iter()
            .map(
                |(region, rank, trainer_id, trainer_name, captures)| TopTrainer {
                    region,
                    rank,
                    trainer_id,
                    trainer_name,
                    captures,
                },
            )
            .collect())
    }

    async fn level_classification_by_type(
        &self,
    ) -> Result<Vec<LevelClassification>, RepositoryError> {
        let rows: Vec<(i32, String, i32, i32, f64)> = sqlx::query_as(
            "SELECT
               type_id,
               type_name,
               total_captures::int,
               high_level_captures::int,
               high_level_pct::float8
             FROM level_classification_by_type
             ORDER BY type_name",
        )
        .fetch_all(&self.pool)
        .await
        .map_err(map_error)?;
        Ok(rows
            .into_iter()
            .map(
                |(type_id, type_name, total_captures, high_level_captures, high_level_percent)| {
                    LevelClassification {
                        type_id,
                        type_name,
                        total_captures,
                        high_level_captures,
                        high_level_percent,
                    }
                },
            )
            .collect())
    }
}
