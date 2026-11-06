use std::sync::Arc;

use axum::Router;
use axum::routing::{get, post};
use pokemon_context_ingestion::application::ports::EtlRunQueue;
use pokemon_context_ingestion::application::use_cases::{EnqueueRun, GetRun, RetryRun};

use super::etl_controller::{self, EtlController};

/// Rutas de `/etl/runs`, con sus casos de uso sobre la cola de corridas.
pub fn etl_module(queue: Arc<dyn EtlRunQueue>) -> Router {
    let controller = Arc::new(EtlController::new(
        EnqueueRun::new(Arc::clone(&queue)),
        GetRun::new(Arc::clone(&queue)),
        RetryRun::new(queue),
    ));
    Router::new()
        .route("/etl/runs", post(etl_controller::enqueue))
        .route("/etl/runs/{run_id}", get(etl_controller::get))
        .route("/etl/runs/{run_id}/retry", post(etl_controller::retry))
        .with_state(controller)
}
