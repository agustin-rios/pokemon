#![allow(clippy::unwrap_used)]

use pokemon_data::errors::error_chain;
use pokemon_data::pokeapi::{AttemptFailure, PokeApiError};

#[test]
fn the_chain_includes_the_root_cause_of_a_failed_scrape() {
    let error = PokeApiError::Exhausted {
        url: "http://x/pokemon/1".into(),
        attempts: 4,
        last: AttemptFailure::Status(503),
    };

    // `Display` (lo que se guarda en la corrida) no cambia; la cadena añade la causa.
    assert_eq!(
        error.to_string(),
        "GET http://x/pokemon/1 falló tras 4 intentos"
    );
    assert_eq!(
        error_chain(&error),
        "GET http://x/pokemon/1 falló tras 4 intentos: HTTP 503"
    );
}

#[test]
fn the_chain_includes_the_decode_error_and_skips_repeated_wrappers() {
    let source = serde_json::from_str::<serde_json::Value>("{").unwrap_err();
    let decode = PokeApiError::Decode {
        url: "u".into(),
        source,
    };
    assert!(error_chain(&decode).starts_with("GET u devolvió una respuesta inválida: EOF"));

    let plain = PokeApiError::InvalidLimit;
    assert_eq!(error_chain(&plain), plain.to_string());
}
