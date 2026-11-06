//! Scrapear un stub que sirve `data-current` debe reproducir esas mismas filas (comparadas
//! como CSV, byte a byte).
#![allow(clippy::unwrap_used)]

mod support;

use std::collections::HashMap;

use pokemon_data::pokeapi::PokeApiClient;
use serde_json::{Value, json};
use support::{Reply, Stub, fast_config};

mod csv_fixtures;
use csv_fixtures::{fixture, pokemon_csv, pokemon_types_csv, read_rows, types_csv};

fn read_csv(name: &str) -> Vec<HashMap<String, String>> {
    read_rows("data-current", name)
}

/// Reconstruye `GET /pokemon/{id}` desde los CSV, con los tipos desordenados a propósito.
fn api_pokemon() -> HashMap<u32, Value> {
    let types: HashMap<String, String> = read_csv("types.csv")
        .into_iter()
        .map(|t| (t["id"].clone(), t["name"].clone()))
        .collect();
    let mut types_by_pokemon: HashMap<String, Vec<Value>> = HashMap::new();
    for pt in read_csv("pokemon_types.csv") {
        types_by_pokemon
            .entry(pt["pokemon_id"].clone())
            .or_default()
            .push(json!({
                "slot": pt["slot"].parse::<i32>().unwrap(),
                "type": {
                    "name": types[&pt["type_id"]],
                    "url": format!("https://pokeapi.co/api/v2/type/{}/", pt["type_id"]),
                },
            }));
    }
    read_csv("pokemon.csv")
        .into_iter()
        .map(|p| {
            let mut slots = types_by_pokemon.remove(&p["id"]).unwrap_or_default();
            slots.sort_by_key(|s| std::cmp::Reverse(s["slot"].as_i64()));
            let experience = &p["base_experience"];
            let sprite = &p["sprite"];
            let body = json!({
                "id": p["id"].parse::<i32>().unwrap(),
                "name": p["name"],
                "height": p["height"].parse::<i32>().unwrap(),
                "weight": p["weight"].parse::<i32>().unwrap(),
                "base_experience": if experience.is_empty() { Value::Null } else { json!(experience.parse::<i32>().unwrap()) },
                "sprites": { "front_default": if sprite.is_empty() { Value::Null } else { json!(sprite) } },
                "types": slots,
            });
            (p["id"].parse().unwrap(), body)
        })
        .collect()
}

#[tokio::test]
async fn scraping_the_reference_stub_reproduces_the_reference_csv_files() {
    let pokemon = api_pokemon();
    assert_eq!(pokemon.len(), 100);
    let stub = Stub::start(move |id, _| Reply::json(200, pokemon[&id].to_string())).await;

    let dataset = PokeApiClient::with_config(stub.base_url.clone(), fast_config())
        .scrape(100)
        .await
        .unwrap();

    for (name, written) in [
        ("pokemon.csv", pokemon_csv(&dataset.pokemon)),
        ("types.csv", types_csv(&dataset.types)),
        (
            "pokemon_types.csv",
            pokemon_types_csv(&dataset.pokemon_types),
        ),
    ] {
        assert_eq!(written, fixture("data-current", name), "{name}");
    }
    assert_eq!(
        (
            dataset.pokemon.len(),
            dataset.types.len(),
            dataset.pokemon_types.len()
        ),
        (100, 16, 148)
    );
}
