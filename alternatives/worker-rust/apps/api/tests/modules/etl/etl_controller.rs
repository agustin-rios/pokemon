use crate::helpers::{RUN_ID, TestApi, run, storage_error};
use axum::http::StatusCode;
use pokemon_context_ingestion::application::{EnqueueError, RetryError};
use pokemon_context_ingestion::domain::RunState;
use serde_json::json;
use uuid::Uuid;

fn run_id() -> Uuid {
    Uuid::parse_str(RUN_ID).unwrap()
}

#[tokio::test]
async fn post_runs_responde_202_con_la_corrida() {
    let api = TestApi::new();
    api.queue.enqueue.set(Ok(run(RunState::Queued)));

    let (status, body) = api.request("POST", "/api/etl/runs").await;

    assert_eq!(status, StatusCode::ACCEPTED);
    assert_eq!(body["runId"], RUN_ID);
    assert_eq!(body["state"], "queued");
    assert_eq!(body["queuedAt"], "2026-11-05T22:19:30.778Z");
    assert_eq!(body["startedAt"], json!(null));
    assert_eq!(body["attempts"], 0);
    let steps = body["steps"].as_array().unwrap();
    let names: Vec<_> = steps.iter().map(|s| s["name"].as_str().unwrap()).collect();
    assert_eq!(
        names,
        ["scrape", "generate", "validate", "load", "build_views"]
    );
    assert_eq!(steps[0]["state"], "pending");
    assert_eq!(steps[0]["output"], json!(null));
}

#[tokio::test]
async fn post_runs_tras_agotar_las_rondas_es_500() {
    let api = TestApi::new();
    api.queue.enqueue.set(Err(EnqueueError::Exhausted));

    let (status, body) = api.request("POST", "/api/etl/runs").await;

    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(body["statusCode"], 500);
}

#[tokio::test]
async fn get_run_devuelve_la_corrida() {
    let api = TestApi::new();
    api.queue.get.set(Ok(Some(run(RunState::Running))));

    let (status, body) = api.get(&format!("/api/etl/runs/{RUN_ID}")).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["state"], "running");
    assert_eq!(api.calls.all(), [format!("get {RUN_ID}")]);
}

#[tokio::test]
async fn get_run_inexistente_es_404() {
    let api = TestApi::new();
    api.queue.get.set(Ok(None));

    let (status, body) = api.get(&format!("/api/etl/runs/{RUN_ID}")).await;

    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(
        body,
        json!({ "message": format!("No existe la corrida {RUN_ID}"), "error": "Not Found", "statusCode": 404 })
    );
}

#[tokio::test]
async fn get_run_con_fallo_de_la_base_es_500() {
    let api = TestApi::new();
    api.queue.get.set(Err(storage_error()));

    let (status, _) = api.get(&format!("/api/etl/runs/{RUN_ID}")).await;

    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
}

#[tokio::test]
async fn un_run_id_que_no_es_uuid_es_400_sin_llamar_al_caso_de_uso() {
    for id in [
        "abc",
        "123",
        "0b9a3f0e4a644d3a9d3e5f2f4c1d7a10",
        "{0b9a3f0e-4a64-4d3a-9d3e-5f2f4c1d7a10}",
    ] {
        let api = TestApi::new();

        let (status, body) = api.get(&format!("/api/etl/runs/{id}")).await;
        let (retry_status, _) = api
            .request("POST", &format!("/api/etl/runs/{id}/retry"))
            .await;

        assert_eq!(status, StatusCode::BAD_REQUEST, "{id}");
        assert_eq!(retry_status, StatusCode::BAD_REQUEST, "{id}");
        assert_eq!(body["message"], "runId debe ser un UUID", "{id}");
        assert!(api.calls.all().is_empty(), "{id}");
    }
}

#[tokio::test]
async fn retry_responde_202_con_la_corrida_encolada() {
    let api = TestApi::new();
    api.queue.retry.set(Ok(run(RunState::Queued)));

    let (status, body) = api
        .request("POST", &format!("/api/etl/runs/{RUN_ID}/retry"))
        .await;

    assert_eq!(status, StatusCode::ACCEPTED);
    assert_eq!(body["state"], "queued");
    assert_eq!(api.calls.all(), [format!("retry {RUN_ID}")]);
}

#[tokio::test]
async fn retry_de_una_corrida_inexistente_es_404() {
    let api = TestApi::new();
    api.queue.retry.set(Err(RetryError::NotFound(run_id())));

    let (status, body) = api
        .request("POST", &format!("/api/etl/runs/{RUN_ID}/retry"))
        .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["message"], format!("No existe la corrida {RUN_ID}"));
}

#[tokio::test]
async fn retry_de_una_corrida_no_fallida_es_409() {
    let api = TestApi::new();
    api.queue.retry.set(Err(RetryError::NotFailed));

    let (status, body) = api
        .request("POST", &format!("/api/etl/runs/{RUN_ID}/retry"))
        .await;

    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(
        body,
        json!({
            "message": "Solo se puede reintentar una corrida fallida",
            "error": "Conflict",
            "statusCode": 409
        })
    );
}

#[tokio::test]
async fn retry_con_otra_corrida_en_curso_es_409() {
    let api = TestApi::new();
    api.queue.retry.set(Err(RetryError::AlreadyActive));

    let (status, body) = api
        .request("POST", &format!("/api/etl/runs/{RUN_ID}/retry"))
        .await;

    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["message"], "Ya hay una corrida en curso");
}
