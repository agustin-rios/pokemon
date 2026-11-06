//! `type_id_from_url` y `Dataset::from_api` (port de los tests de `platform/ops`).
#![allow(clippy::unwrap_used)]

use pokemon_data::dataset::{ApiPokemon, Dataset, PokemonTypeRow, TypeRow};
use pokemon_data::pokeapi::{PokeApiError, type_id_from_url};
use serde_json::json;

fn pokemon(id: i32, name: &str, types: &[(&str, i32)]) -> ApiPokemon {
    serde_json::from_value(json!({
        "id": id,
        "name": name,
        "base_experience": id * 10,
        "height": 1,
        "weight": 1,
        "sprites": { "front_default": format!("https://img/{id}.png") },
        "types": types.iter().enumerate().map(|(i, (type_name, type_id))| json!({
            "slot": i + 1,
            "type": { "name": type_name, "url": format!("https://pokeapi.co/api/v2/type/{type_id}/") },
        })).collect::<Vec<_>>(),
    }))
    .unwrap()
}

#[test]
fn type_id_comes_from_the_end_of_the_url_path() {
    assert_eq!(
        type_id_from_url("https://pokeapi.co/api/v2/type/12/").unwrap(),
        12
    );
    assert_eq!(
        type_id_from_url("https://pokeapi.co/api/v2/type/12").unwrap(),
        12
    );
    assert_eq!(
        type_id_from_url("https://pokeapi.co/api/v2/type/7/?x=1#y").unwrap(),
        7
    );
}

#[test]
fn unexpected_type_urls_are_rejected_with_the_url_in_the_message() {
    for url in [
        "https://pokeapi.co/api/v2/pokemon/1/",
        "https://pokeapi.co/api/v2/type/",
        "https://pokeapi.co/api/v2/type/abc/",
        "https://pokeapi.co/api/v2/type/12//",
        "https://pokeapi.co/api/v2/type/99999999999/",
        "no es una url",
    ] {
        let err = type_id_from_url(url).unwrap_err();
        assert!(matches!(err, PokeApiError::UnexpectedTypeUrl(_)), "{url}");
        assert_eq!(err.to_string(), format!("URL de tipo inesperada: {url}"));
    }
}

#[test]
fn sorts_by_id_and_deduplicates_types_regardless_of_arrival_order() {
    let dataset = Dataset::from_api(&[
        pokemon(4, "charmander", &[("fire", 10)]),
        pokemon(1, "bulbasaur", &[("grass", 12), ("poison", 4)]),
        pokemon(2, "ivysaur", &[("grass", 12), ("poison", 4)]),
    ])
    .unwrap();

    let ids: Vec<i32> = dataset.pokemon.iter().map(|p| p.id).collect();
    assert_eq!(ids, [1, 2, 4]);
    assert_eq!(
        dataset.types,
        [
            TypeRow {
                id: 4,
                name: "poison".into()
            },
            TypeRow {
                id: 10,
                name: "fire".into()
            },
            TypeRow {
                id: 12,
                name: "grass".into()
            },
        ]
    );
    let relation = |pokemon_id, type_id, slot| PokemonTypeRow {
        pokemon_id,
        type_id,
        slot,
    };
    assert_eq!(
        dataset.pokemon_types,
        [
            relation(1, 12, 1),
            relation(1, 4, 2),
            relation(2, 12, 1),
            relation(2, 4, 2),
            relation(4, 10, 1)
        ]
    );
    assert_eq!(
        dataset.pokemon[0].sprite.as_deref(),
        Some("https://img/1.png")
    );
}

#[test]
fn orders_relations_by_slot_even_when_the_api_lists_them_reversed() {
    let mut p = pokemon(1, "bulbasaur", &[("grass", 12), ("poison", 4)]);
    p.types.reverse();
    let dataset = Dataset::from_api(&[p]).unwrap();
    let slots: Vec<i32> = dataset.pokemon_types.iter().map(|r| r.slot).collect();
    assert_eq!(slots, [1, 2]);
}

#[test]
fn null_experience_and_sprite_stay_null() {
    let mut p = pokemon(1, "bulbasaur", &[("grass", 12)]);
    p.base_experience = None;
    p.sprites.front_default = None;
    let dataset = Dataset::from_api(&[p]).unwrap();
    assert_eq!(dataset.pokemon[0].base_experience, None);
    assert_eq!(dataset.pokemon[0].sprite, None);
}

#[test]
fn a_bad_type_url_fails_the_conversion() {
    let mut p = pokemon(1, "bulbasaur", &[("grass", 12)]);
    p.types[0].kind.url = "https://pokeapi.co/api/v2/pokemon/1/".into();
    assert!(matches!(
        Dataset::from_api(&[p]),
        Err(PokeApiError::UnexpectedTypeUrl(_))
    ));
}
