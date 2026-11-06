//! Adaptador de PokeAPI (no necesita base de datos).

use std::net::SocketAddr;

use axum::routing::get;
use axum::{Json, Router, extract::Path};
use pokemon_context_ingestion::application::ports::PokemonSource;
use pokemon_context_ingestion::infra::adapters::PokeApiSource;
use pokemon_data::pokeapi::{PokeApiClient, PokeApiError};
use serde_json::{Value, json};

fn pokemon_json(id: i64) -> Value {
    json!({
        "id": id,
        "name": format!("pokemon-{id}"),
        "height": 10,
        "weight": 20,
        "base_experience": null,
        "sprites": {"front_default": null},
        "types": [{"slot": 1, "type": {"name": "grass", "url": "https://pokeapi.co/api/v2/type/12/"}}],
    })
}

async fn serve(router: Router) -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr: SocketAddr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    format!("http://{addr}")
}

#[tokio::test]
async fn pokeapi_source_scrapes_through_the_data_client() {
    let base = serve(Router::new().route(
        "/pokemon/{id}",
        get(|Path(id): Path<i64>| async move { Json(pokemon_json(id)) }),
    ))
    .await;
    let source = PokeApiSource::new(PokeApiClient::new(base));

    let dataset = source.scrape(3).await.unwrap();

    assert_eq!(dataset.pokemon.len(), 3);
    assert_eq!(dataset.types.len(), 1);
    assert_eq!(dataset.types[0].id, 12);
    assert_eq!(dataset.pokemon_types.len(), 3);
}

#[tokio::test]
async fn pokeapi_source_reports_client_errors() {
    let base = serve(Router::new()).await; // todo es 404
    let source = PokeApiSource::new(PokeApiClient::new(base.clone()));

    let error = source.scrape(2).await.unwrap_err();

    assert!(matches!(error, PokeApiError::Status { status: 404, .. }));
    assert_eq!(
        error.to_string(),
        format!("GET {base}/pokemon/1 respondió HTTP 404")
    );
}
