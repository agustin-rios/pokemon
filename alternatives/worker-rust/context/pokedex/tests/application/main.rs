//! Casos de uso del contexto con repositorios falsos (sin base de datos).
#![allow(clippy::unwrap_used)]

#[path = "../stubs/mod.rs"]
mod stubs;

mod use_cases {
    mod get_pokemon;
    mod list_pokemon;
    mod reports;
}
