use std::sync::Arc;

use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use pokemon_context_ingestion::application::use_cases::{EnqueueRun, GetRun, RetryRun};
use pokemon_context_ingestion::domain::EtlRun;
use uuid::Uuid;

use crate::common::filters::ApiError;

/// Los casos de uso que sirve `/etl/runs`.
pub struct EtlController {
    enqueue_run: EnqueueRun,
    get_run: GetRun,
    retry_run: RetryRun,
}

impl EtlController {
    pub fn new(enqueue_run: EnqueueRun, get_run: GetRun, retry_run: RetryRun) -> Self {
        Self {
            enqueue_run,
            get_run,
            retry_run,
        }
    }
}

/// `:runId` debe ser un UUID con guiones (el formato que devuelve la API).
fn parse_run_id(raw: &str) -> Result<Uuid, ApiError> {
    Some(raw)
        .filter(|text| text.len() == 36)
        .and_then(|text| Uuid::parse_str(text).ok())
        .ok_or_else(|| ApiError::BadRequest("runId debe ser un UUID".into()))
}

/// `POST /etl/runs`: encola una corrida, o devuelve la que ya está en curso.
/// 202: el worker la ejecuta sin que el request espere.
pub async fn enqueue(
    State(controller): State<Arc<EtlController>>,
) -> Result<(StatusCode, Json<EtlRun>), ApiError> {
    Ok((
        StatusCode::ACCEPTED,
        Json(controller.enqueue_run.execute().await?),
    ))
}

/// `GET /etl/runs/:runId`.
pub async fn get(
    State(controller): State<Arc<EtlController>>,
    Path(run_id): Path<String>,
) -> Result<Json<EtlRun>, ApiError> {
    let run_id = parse_run_id(&run_id)?;
    Ok(Json(controller.get_run.execute(run_id).await?))
}

/// `POST /etl/runs/:runId/retry`: la corrida fallida retoma desde su paso fallido.
pub async fn retry(
    State(controller): State<Arc<EtlController>>,
    Path(run_id): Path<String>,
) -> Result<(StatusCode, Json<EtlRun>), ApiError> {
    let run_id = parse_run_id(&run_id)?;
    Ok((
        StatusCode::ACCEPTED,
        Json(controller.retry_run.execute(run_id).await?),
    ))
}
