//! Configuración global: prefijo `/api`, 404 de Nest y CORS.
#![allow(clippy::unwrap_used)]

mod helpers;

use axum::http::StatusCode;
use helpers::TestApi;
use pokemon_api::config::CorsOrigins;
use serde_json::json;

#[tokio::test]
async fn con_asterisco_refleja_el_origen_de_cada_request() {
    let api = TestApi::new();

    let (_, headers, _) = api
        .send(
            "GET",
            "/api/health",
            &[("origin", "http://cualquiera.example")],
        )
        .await;

    assert_eq!(
        headers["access-control-allow-origin"],
        "http://cualquiera.example"
    );
}

#[tokio::test]
async fn con_una_lista_solo_acepta_esos_origenes() {
    let api = TestApi::with_cors(&CorsOrigins::List(vec!["http://localhost:8021".into()]));

    let (_, allowed, _) = api
        .send("GET", "/api/health", &[("origin", "http://localhost:8021")])
        .await;
    let (_, denied, _) = api
        .send("GET", "/api/health", &[("origin", "http://otro.example")])
        .await;

    assert_eq!(
        allowed["access-control-allow-origin"],
        "http://localhost:8021"
    );
    assert!(!denied.contains_key("access-control-allow-origin"));
}

#[tokio::test]
async fn responde_el_preflight() {
    let api = TestApi::new();

    let (status, headers, _) = api
        .send(
            "OPTIONS",
            "/api/etl/runs",
            &[
                ("origin", "http://localhost:8021"),
                ("access-control-request-method", "POST"),
            ],
        )
        .await;

    assert!(status.is_success());
    assert!(
        headers["access-control-allow-methods"]
            .to_str()
            .unwrap()
            .contains("POST")
    );
}

#[tokio::test]
async fn una_ruta_que_no_existe_es_404_con_el_cuerpo_de_nest() {
    let api = TestApi::new();

    let (status, body) = api.get("/api/nada").await;

    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(
        body,
        json!({ "message": "Cannot GET /api/nada", "error": "Not Found", "statusCode": 404 })
    );
}

#[tokio::test]
async fn un_metodo_no_soportado_tambien_es_404() {
    let api = TestApi::new();

    let (status, body) = api.request("POST", "/api/items").await;

    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["message"], "Cannot POST /api/items");
}

#[tokio::test]
async fn sin_el_prefijo_api_no_hay_rutas() {
    let api = TestApi::new();

    let (status, _) = api.get("/health").await;

    assert_eq!(status, StatusCode::NOT_FOUND);
}
