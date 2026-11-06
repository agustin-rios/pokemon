use async_trait::async_trait;
use serde_json::Value;
use sqlx::postgres::PgRow;
use sqlx::{PgPool, Row};
use uuid::Uuid;

use super::storage_error;
use crate::application::ports::{ClaimedRun, EtlRunQueue, FailureOutcome, Fence};
use crate::application::{EnqueueError, RetryError};
use crate::domain::{EtlRun, EtlStep, RunState, StepName, StepState, StorageError};

/// Rondas máximas del encolado antes de rendirse (la corrida activa terminó
/// justo entre el `INSERT` y el `SELECT`).
const ENQUEUE_ROUNDS: u8 = 3;

/// Instante en UTC con el formato que expone la API (lo da la base, no el host).
macro_rules! fmt_ts {
    ($column:literal) => {
        concat!(
            "to_char(",
            $column,
            " AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')"
        )
    };
}

const SELECT_RUN: &str = concat!(
    "SELECT id::text, status, attempts, error, ",
    fmt_ts!("created_at"),
    ", ",
    fmt_ts!("started_at"),
    ", ",
    fmt_ts!("finished_at"),
    " FROM etl_runs WHERE id = $1::uuid"
);

const SELECT_STEPS: &str = concat!(
    "SELECT step, status, attempts, error, output, ",
    fmt_ts!("started_at"),
    ", ",
    fmt_ts!("finished_at"),
    " FROM etl_run_steps WHERE run_id = $1::uuid ORDER BY position"
);

/// Corridas marcadas como muertas (sin intentos) y sus pasos en ejecución.
const POISON_RUNS: &str = "\
WITH dead AS (
  UPDATE etl_runs
  SET status = 'failed', finished_at = now(), locked_by = NULL, locked_until = NULL,
      error = 'el worker se detuvo sin terminar y se agotaron los intentos'
  WHERE status = 'running' AND locked_until < now() AND attempts >= max_attempts
  RETURNING id)
UPDATE etl_run_steps s
SET status = 'failed', finished_at = now(), error = 'interrumpido: el worker se detuvo'
FROM dead WHERE s.run_id = dead.id AND s.status = 'running'";

const CLAIM_RUN: &str = "\
UPDATE etl_runs
SET status = 'running', attempts = attempts + 1, locked_by = $1,
    locked_until = now() + make_interval(secs => $2),
    started_at = coalesce(started_at, now()), error = NULL
WHERE id = (
  SELECT id FROM etl_runs
  WHERE (status = 'queued' AND run_after <= now())
     OR (status = 'running' AND locked_until < now() AND attempts < max_attempts)
  ORDER BY created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1)
RETURNING id, attempts, max_attempts";

/// Cola de corridas en Postgres: la tabla `etl_runs` es también la cola.
pub struct PgEtlRunQueue {
    pool: PgPool,
}

impl PgEtlRunQueue {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Una ronda de encolado. `Some` si la corrida (nueva o la activa) se encontró.
    async fn enqueue_round(&self) -> Result<Option<Uuid>, StorageError> {
        let mut tx = self.pool.begin().await.map_err(storage_error)?;
        let created: Option<Uuid> = sqlx::query_scalar(
            "INSERT INTO etl_runs DEFAULT VALUES ON CONFLICT DO NOTHING RETURNING id",
        )
        .fetch_optional(&mut *tx)
        .await
        .map_err(storage_error)?;

        if let Some(run_id) = created {
            // Corrida y pasos en la misma transacción: el worker nunca ve una sin pasos.
            sqlx::query(
                "INSERT INTO etl_run_steps (run_id, step, position) SELECT $1::uuid, t.s, t.p \
                 FROM unnest(ARRAY['scrape','generate','validate','load','build_views']) \
                 WITH ORDINALITY AS t(s, p)",
            )
            .bind(run_id)
            .execute(&mut *tx)
            .await
            .map_err(storage_error)?;
            tx.commit().await.map_err(storage_error)?;
            return Ok(Some(run_id));
        }

        tx.commit().await.map_err(storage_error)?;
        sqlx::query_scalar("SELECT id FROM etl_runs WHERE status IN ('queued', 'running') LIMIT 1")
            .fetch_optional(&self.pool)
            .await
            .map_err(storage_error)
    }

    async fn run_row(&self, run_id: Uuid) -> Result<Option<EtlRun>, StorageError> {
        let Some(row) = sqlx::query(SELECT_RUN)
            .bind(run_id)
            .fetch_optional(&self.pool)
            .await
            .map_err(storage_error)?
        else {
            return Ok(None);
        };
        let steps = sqlx::query(SELECT_STEPS)
            .bind(run_id)
            .fetch_all(&self.pool)
            .await
            .map_err(storage_error)?;
        decode_run(&row, &steps).map(Some)
    }
}

fn corrupt(what: &str, value: &str) -> StorageError {
    StorageError {
        sqlstate: None,
        source: format!("{what} desconocido en la base: {value}").into(),
    }
}

fn decode_run(row: &PgRow, steps: &[PgRow]) -> Result<EtlRun, StorageError> {
    let state: String = row.try_get(1).map_err(storage_error)?;
    let run_id: String = row.try_get(0).map_err(storage_error)?;
    Ok(EtlRun {
        run_id: run_id.parse().map_err(|_| corrupt("id", &run_id))?,
        state: RunState::parse(&state).ok_or_else(|| corrupt("estado", &state))?,
        attempts: row.try_get(2).map_err(storage_error)?,
        error: row.try_get(3).map_err(storage_error)?,
        queued_at: row.try_get(4).map_err(storage_error)?,
        started_at: row.try_get(5).map_err(storage_error)?,
        finished_at: row.try_get(6).map_err(storage_error)?,
        steps: steps
            .iter()
            .map(decode_step)
            .collect::<Result<Vec<_>, _>>()?,
    })
}

fn decode_step(row: &PgRow) -> Result<EtlStep, StorageError> {
    let name: String = row.try_get(0).map_err(storage_error)?;
    let state: String = row.try_get(1).map_err(storage_error)?;
    Ok(EtlStep {
        name: StepName::parse(&name).ok_or_else(|| corrupt("paso", &name))?,
        state: StepState::parse(&state).ok_or_else(|| corrupt("estado de paso", &state))?,
        attempts: row.try_get(2).map_err(storage_error)?,
        error: row.try_get(3).map_err(storage_error)?,
        output: row.try_get::<Option<Value>, _>(4).map_err(storage_error)?,
        started_at: row.try_get(5).map_err(storage_error)?,
        finished_at: row.try_get(6).map_err(storage_error)?,
    })
}

#[async_trait]
impl EtlRunQueue for PgEtlRunQueue {
    async fn enqueue(&self) -> Result<EtlRun, EnqueueError> {
        for _ in 0..ENQUEUE_ROUNDS {
            if let Some(run_id) = self.enqueue_round().await?
                && let Some(run) = self.run_row(run_id).await?
            {
                return Ok(run);
            }
        }
        Err(EnqueueError::Exhausted)
    }

    async fn get(&self, run_id: Uuid) -> Result<Option<EtlRun>, StorageError> {
        self.run_row(run_id).await
    }

    async fn retry(&self, run_id: Uuid) -> Result<EtlRun, RetryError> {
        // `started_at` y los pasos se conservan: la corrida retoma desde el paso fallido.
        let updated = sqlx::query_scalar::<_, Uuid>(
            "UPDATE etl_runs SET status = 'queued', attempts = 0, run_after = now(), \
             error = NULL, finished_at = NULL, locked_by = NULL, locked_until = NULL \
             WHERE id = $1::uuid AND status = 'failed' RETURNING id",
        )
        .bind(run_id)
        .fetch_optional(&self.pool)
        .await;

        match updated {
            // El índice único parcial rechaza una segunda corrida activa.
            Err(e) if e.as_database_error().and_then(|d| d.code()).as_deref() == Some("23505") => {
                return Err(RetryError::AlreadyActive);
            }
            Err(e) => return Err(storage_error(e).into()),
            Ok(Some(_)) => {}
            Ok(None) => {
                let status: Option<String> =
                    sqlx::query_scalar("SELECT status FROM etl_runs WHERE id = $1::uuid")
                        .bind(run_id)
                        .fetch_optional(&self.pool)
                        .await
                        .map_err(storage_error)?;
                return Err(match status {
                    None => RetryError::NotFound(run_id),
                    Some(_) => RetryError::NotFailed,
                });
            }
        }
        self.run_row(run_id)
            .await?
            .ok_or(RetryError::NotFound(run_id))
    }

    async fn claim(
        &self,
        worker_id: &str,
        lease_seconds: f64,
    ) -> Result<Option<ClaimedRun>, StorageError> {
        sqlx::query(POISON_RUNS)
            .execute(&self.pool)
            .await
            .map_err(storage_error)?;
        let claimed = sqlx::query_as::<_, (Uuid, i32, i32)>(CLAIM_RUN)
            .bind(worker_id)
            .bind(lease_seconds)
            .fetch_optional(&self.pool)
            .await
            .map_err(storage_error)?;
        Ok(claimed.map(|(run_id, attempts, max_attempts)| ClaimedRun {
            fence: Fence {
                run_id,
                worker_id: worker_id.to_owned(),
                attempts,
            },
            max_attempts,
        }))
    }

    async fn heartbeat(&self, fence: &Fence, lease_seconds: f64) -> Result<bool, StorageError> {
        let result = sqlx::query(
            "UPDATE etl_runs SET locked_until = now() + make_interval(secs => $3) \
             WHERE id = $1::uuid AND locked_by = $2 AND attempts = $4 AND status = 'running'",
        )
        .bind(fence.run_id)
        .bind(&fence.worker_id)
        .bind(lease_seconds)
        .bind(fence.attempts)
        .execute(&self.pool)
        .await
        .map_err(storage_error)?;
        Ok(result.rows_affected() == 1)
    }

    async fn start_step(&self, fence: &Fence, step: StepName) -> Result<bool, StorageError> {
        let result = sqlx::query(
            "UPDATE etl_run_steps s SET status = 'running', attempts = s.attempts + 1, \
             started_at = now(), finished_at = NULL, error = NULL, output = NULL \
             FROM etl_runs r WHERE s.run_id = $1::uuid AND s.step = $2 AND r.id = s.run_id \
             AND r.locked_by = $3 AND r.attempts = $4 AND r.status = 'running' \
             AND s.status <> 'succeeded'",
        )
        .bind(fence.run_id)
        .bind(step.as_str())
        .bind(&fence.worker_id)
        .bind(fence.attempts)
        .execute(&self.pool)
        .await
        .map_err(storage_error)?;
        Ok(result.rows_affected() == 1)
    }

    async fn finish_step(
        &self,
        fence: &Fence,
        step: StepName,
        output: Option<&Value>,
    ) -> Result<bool, StorageError> {
        let result = sqlx::query(
            "UPDATE etl_run_steps s SET status = 'succeeded', finished_at = now(), \
             output = $5::jsonb \
             FROM etl_runs r WHERE s.run_id = $1::uuid AND s.step = $2 AND r.id = s.run_id \
             AND r.locked_by = $3 AND r.attempts = $4 AND r.status = 'running' \
             AND s.status = 'running'",
        )
        .bind(fence.run_id)
        .bind(step.as_str())
        .bind(&fence.worker_id)
        .bind(fence.attempts)
        .bind(output)
        .execute(&self.pool)
        .await
        .map_err(storage_error)?;
        Ok(result.rows_affected() == 1)
    }

    async fn complete_run(&self, fence: &Fence) -> Result<bool, StorageError> {
        let result = sqlx::query(
            "UPDATE etl_runs SET status = 'succeeded', finished_at = now(), error = NULL, \
             locked_by = NULL, locked_until = NULL \
             WHERE id = $1::uuid AND locked_by = $2 AND attempts = $3 AND status = 'running'",
        )
        .bind(fence.run_id)
        .bind(&fence.worker_id)
        .bind(fence.attempts)
        .execute(&self.pool)
        .await
        .map_err(storage_error)?;
        Ok(result.rows_affected() == 1)
    }

    async fn fail_step(
        &self,
        fence: &Fence,
        step: StepName,
        message: &str,
        retryable: bool,
    ) -> Result<FailureOutcome, StorageError> {
        let run_error = format!("{step}: {message}");
        let mut tx = self.pool.begin().await.map_err(storage_error)?;

        // Primero la corrida, que debe afectar exactamente 1 fila (si no, se perdió el lease).
        let mut outcome = FailureOutcome::Failed;
        let mut affected = 0;
        if retryable {
            affected = sqlx::query(
                "UPDATE etl_runs SET status = 'queued', \
                 run_after = now() + make_interval(secs => least(60, 5 * 2 ^ (attempts - 1))), \
                 error = $3, locked_by = NULL, locked_until = NULL \
                 WHERE id = $1::uuid AND locked_by = $2 AND attempts = $4 \
                 AND status = 'running' AND attempts < max_attempts",
            )
            .bind(fence.run_id)
            .bind(&fence.worker_id)
            .bind(&run_error)
            .bind(fence.attempts)
            .execute(&mut *tx)
            .await
            .map_err(storage_error)?
            .rows_affected();
            outcome = FailureOutcome::Requeued;
        }
        if affected == 0 {
            outcome = FailureOutcome::Failed;
            affected = sqlx::query(
                "UPDATE etl_runs SET status = 'failed', error = $3, finished_at = now(), \
                 locked_by = NULL, locked_until = NULL \
                 WHERE id = $1::uuid AND locked_by = $2 AND attempts = $4 AND status = 'running'",
            )
            .bind(fence.run_id)
            .bind(&fence.worker_id)
            .bind(&run_error)
            .bind(fence.attempts)
            .execute(&mut *tx)
            .await
            .map_err(storage_error)?
            .rows_affected();
        }
        if affected != 1 {
            tx.rollback().await.map_err(storage_error)?;
            return Ok(FailureOutcome::LeaseLost);
        }

        sqlx::query(
            "UPDATE etl_run_steps SET status = 'failed', finished_at = now(), error = $3 \
             WHERE run_id = $1::uuid AND step = $2 AND status = 'running'",
        )
        .bind(fence.run_id)
        .bind(step.as_str())
        .bind(message)
        .execute(&mut *tx)
        .await
        .map_err(storage_error)?;
        tx.commit().await.map_err(storage_error)?;
        Ok(outcome)
    }

    async fn release(&self, fence: &Fence) -> Result<bool, StorageError> {
        let mut tx = self.pool.begin().await.map_err(storage_error)?;
        let released = sqlx::query(
            "UPDATE etl_runs SET status = 'queued', attempts = attempts - 1, run_after = now(), \
             locked_by = NULL, locked_until = NULL \
             WHERE id = $1::uuid AND locked_by = $2 AND attempts = $3 AND status = 'running'",
        )
        .bind(fence.run_id)
        .bind(&fence.worker_id)
        .bind(fence.attempts)
        .execute(&mut *tx)
        .await
        .map_err(storage_error)?
        .rows_affected();
        if released != 1 {
            tx.rollback().await.map_err(storage_error)?;
            return Ok(false);
        }
        sqlx::query(
            "UPDATE etl_run_steps SET status = 'pending', started_at = NULL \
             WHERE run_id = $1::uuid AND status = 'running'",
        )
        .bind(fence.run_id)
        .execute(&mut *tx)
        .await
        .map_err(storage_error)?;
        tx.commit().await.map_err(storage_error)?;
        Ok(true)
    }
}
