use crate::helpers::{TestApi, charizard};
use axum::http::StatusCode;
use pokemon_context_pokedex::application::RepositoryError;
use pokemon_context_pokedex::application::ports::Page;
use pokemon_context_pokedex::domain::TypeSummary;
use serde_json::json;

fn page(
    items: Vec<pokemon_context_pokedex::domain::Pokemon>,
    page: i32,
    size: i32,
) -> Page<pokemon_context_pokedex::domain::Pokemon> {
    Page {
        items,
        total: 100,
        page,
        page_size: size,
    }
}

fn charizard_json() -> serde_json::Value {
    json!({
        "id": 6, "name": "charizard", "height": 17, "weight": 905, "baseExperience": 267,
        "sprite": "https://img/6.png",
        "types": [{ "id": 10, "name": "fire", "slot": 1 }, { "id": 3, "name": "flying", "slot": 2 }],
    })
}

#[tokio::test]
async fn list_usa_la_pagina_por_defecto() {
    let api = TestApi::new();
    api.pokemon.list.set(Ok(page(vec![charizard()], 1, 20)));

    let (status, body) = api.get("/api/items").await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body,
        json!({ "items": [charizard_json()], "total": 100, "page": 1, "pageSize": 20 })
    );
    assert_eq!(api.calls.all(), ["list 1 20"]);
}

#[tokio::test]
async fn list_convierte_page_y_page_size_a_numero() {
    let api = TestApi::new();
    api.pokemon.list.set(Ok(page(vec![], 2, 5)));

    let (status, _) = api.get("/api/items?page=2&pageSize=5").await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(api.calls.all(), ["list 2 5"]);
}

#[tokio::test]
async fn list_rechaza_parametros_invalidos_sin_llamar_al_caso_de_uso() {
    for (query, message) in [
        ("page=0", "page debe ser un entero ≥ 1"),
        ("page=x", "page debe ser un entero ≥ 1"),
        ("page=1.5", "page debe ser un entero ≥ 1"),
        ("pageSize=0", "pageSize debe ser un entero entre 1 y 100"),
        ("pageSize=101", "pageSize debe ser un entero entre 1 y 100"),
        ("pageSize=x", "pageSize debe ser un entero entre 1 y 100"),
    ] {
        let api = TestApi::new();

        let (status, body) = api.get(&format!("/api/items?{query}")).await;

        assert_eq!(status, StatusCode::BAD_REQUEST, "{query}");
        assert_eq!(
            body,
            json!({ "message": message, "error": "Bad Request", "statusCode": 400 }),
            "{query}"
        );
        assert!(api.calls.all().is_empty(), "{query}");
    }
}

#[tokio::test]
async fn summary_no_cae_en_la_ruta_id() {
    let api = TestApi::new();
    api.reports.type_summary.set(Ok(vec![TypeSummary {
        type_id: 10,
        type_name: "fire".into(),
        pokemon_count: 12,
        average_base_experience: 145.08,
    }]));

    let (status, body) = api.get("/api/items/summary").await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body,
        json!([{ "typeId": 10, "typeName": "fire", "pokemonCount": 12, "averageBaseExperience": 145.08 }])
    );
    assert_eq!(api.calls.all(), ["type_summary"]);
}

#[tokio::test]
async fn find_one_devuelve_el_pokemon_con_sus_tipos() {
    let api = TestApi::new();
    api.pokemon.find.set(Ok(Some(charizard())));

    let (status, body) = api.get("/api/items/6").await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, charizard_json());
    assert_eq!(api.calls.all(), ["find 6"]);
}

#[tokio::test]
async fn find_one_inexistente_es_404() {
    let api = TestApi::new();
    api.pokemon.find.set(Ok(None));

    let (status, body) = api.get("/api/items/999").await;

    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(
        body,
        json!({ "message": "No existe el Pokémon 999", "error": "Not Found", "statusCode": 404 })
    );
}

#[tokio::test]
async fn find_one_con_id_invalido_es_400_sin_llamar_al_caso_de_uso() {
    for id in ["abc", "0", "-1", "1.5"] {
        let api = TestApi::new();

        let (status, body) = api.get(&format!("/api/items/{id}")).await;

        assert_eq!(status, StatusCode::BAD_REQUEST, "{id}");
        assert_eq!(body["message"], "id debe ser un entero positivo", "{id}");
        assert!(api.calls.all().is_empty(), "{id}");
    }
}

#[tokio::test]
async fn summary_sin_la_vista_en_la_base_es_503() {
    let api = TestApi::new();
    api.reports
        .type_summary
        .set(Err(RepositoryError::DataNotLoaded));

    let (status, body) = api.get("/api/items/summary").await;

    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(
        body,
        json!({
            "message": "Los datos todavía no están cargados.",
            "error": "Service Unavailable",
            "statusCode": 503
        })
    );
}

#[tokio::test]
async fn un_fallo_de_la_base_es_500_sin_exponer_el_detalle() {
    let api = TestApi::new();
    api.pokemon
        .list
        .set(Err(RepositoryError::Storage("secreto interno".into())));

    let (status, body) = api.get("/api/items").await;

    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(
        body,
        json!({ "message": "Internal server error", "error": "Internal Server Error", "statusCode": 500 })
    );
}
