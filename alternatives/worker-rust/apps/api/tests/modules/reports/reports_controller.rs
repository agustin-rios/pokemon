use crate::helpers::TestApi;
use axum::http::StatusCode;
use pokemon_context_pokedex::application::RepositoryError;
use pokemon_context_pokedex::domain::{LevelClassification, MonthlyCaptureGrowth, TopTrainer};
use serde_json::json;

#[tokio::test]
async fn monthly_growth_devuelve_lo_que_entrega_su_caso_de_uso() {
    let api = TestApi::new();
    api.reports.monthly.set(Ok(vec![MonthlyCaptureGrowth {
        month: "2025-11".into(),
        captures: 233,
        change_percent: None,
    }]));

    let (status, body) = api.get("/api/reports/monthly-growth").await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body,
        json!([{ "month": "2025-11", "captures": 233, "changePercent": null }])
    );
}

#[tokio::test]
async fn top_trainers_devuelve_lo_que_entrega_su_caso_de_uso() {
    let api = TestApi::new();
    api.reports.top.set(Ok(vec![TopTrainer {
        region: "Hoenn".into(),
        rank: 1,
        trainer_id: 32,
        trainer_name: "Ethan Platt".into(),
        captures: 224,
    }]));

    let (status, body) = api.get("/api/reports/top-trainers").await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body,
        json!([{ "region": "Hoenn", "rank": 1, "trainerId": 32, "trainerName": "Ethan Platt", "captures": 224 }])
    );
}

#[tokio::test]
async fn level_classification_devuelve_lo_que_entrega_su_caso_de_uso() {
    let api = TestApi::new();
    api.reports.level.set(Ok(vec![LevelClassification {
        type_id: 7,
        type_name: "bug".into(),
        total_captures: 1044,
        high_level_captures: 140,
        high_level_percent: 13.41,
    }]));

    let (status, body) = api.get("/api/reports/level-classification").await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body,
        json!([{
            "typeId": 7, "typeName": "bug", "totalCaptures": 1044,
            "highLevelCaptures": 140, "highLevelPercent": 13.41
        }])
    );
}

#[tokio::test]
async fn sin_la_vista_en_la_base_es_503() {
    let api = TestApi::new();
    api.reports.top.set(Err(RepositoryError::DataNotLoaded));

    let (status, _) = api.get("/api/reports/top-trainers").await;

    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
}
