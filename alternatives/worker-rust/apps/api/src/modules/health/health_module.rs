use axum::Router;
use axum::routing::get;

use super::health_controller;

/// Rutas de `/health`.
pub fn health_module() -> Router {
    Router::new().route("/health", get(health_controller::check))
}
