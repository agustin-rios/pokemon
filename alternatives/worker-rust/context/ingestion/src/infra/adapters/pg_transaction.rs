//! Piezas comunes de las transacciones que escriben datos de la corrida.

use std::time::Duration;

use sqlx::{PgPool, Postgres, Transaction};

use super::storage_error;
use crate::application::ports::Fence;
use crate::domain::StorageError;

/// Tiempo máximo de cada sentencia de un paso que usa la base; al vencer, Postgres la
/// cancela (SQLSTATE `57014`) y el error es reintentable.
pub const DEFAULT_STATEMENT_TIMEOUT: Duration = Duration::from_secs(60);

/// Abre una transacción con `statement_timeout` solo para ella. Si el future se abandona
/// antes del commit, la transacción se descarta sin escribir nada.
pub(super) async fn begin(
    pool: &PgPool,
    statement_timeout: Duration,
) -> Result<Transaction<'static, Postgres>, StorageError> {
    let mut tx = pool.begin().await.map_err(storage_error)?;
    sqlx::query("SELECT set_config('statement_timeout', $1, true)")
        .bind(format!("{}ms", statement_timeout.as_millis()))
        .execute(&mut *tx)
        .await
        .map_err(storage_error)?;
    Ok(tx)
}

/// Justo antes del commit: `true` si la corrida sigue siendo de este worker. Si el lease
/// se perdió otro worker puede estar escribiendo; `FOR SHARE` bloquea cualquier cambio
/// de la corrida hasta el commit. Sin `fence` no hay nada que verificar.
pub(super) async fn still_owner(
    tx: &mut Transaction<'static, Postgres>,
    fence: Option<&Fence>,
) -> Result<bool, StorageError> {
    let Some(fence) = fence else {
        return Ok(true);
    };
    let row = sqlx::query(
        "SELECT 1 FROM etl_runs WHERE id = $1::uuid AND locked_by = $2 \
         AND attempts = $3 AND status = 'running' FOR SHARE",
    )
    .bind(fence.run_id)
    .bind(&fence.worker_id)
    .bind(fence.attempts)
    .fetch_optional(&mut **tx)
    .await
    .map_err(storage_error)?;
    Ok(row.is_some())
}
