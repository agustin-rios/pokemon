//! Adaptadores del contexto contra Postgres real. Necesitan `TEST_DATABASE_URL`;
//! sin ella se omiten.
#![allow(clippy::unwrap_used)]

#[path = "../support/mod.rs"]
mod support;

mod adapters {
    mod pg_pokemon_repository;
    mod pg_reports_repository;
}
