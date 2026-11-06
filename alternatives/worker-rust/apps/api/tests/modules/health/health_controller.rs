//! `GET /api/health`.

use axum::http::StatusCode;
use serde_json::json;

use crate::helpers::TestApi;

#[tokio::test]
async fn responde_ok_en_get_api_health() {
    let api = TestApi::new();

    let (status, body) = api.get("/api/health").await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, json!({ "status": "ok" }));
}
