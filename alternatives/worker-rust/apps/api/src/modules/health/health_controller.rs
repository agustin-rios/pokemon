use axum::Json;
use serde::Serialize;

#[derive(Serialize)]
pub struct Health {
    status: &'static str,
}

/// `GET /health`.
pub async fn check() -> Json<Health> {
    Json(Health { status: "ok" })
}
