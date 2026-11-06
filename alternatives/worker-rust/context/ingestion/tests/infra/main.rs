//! Adaptadores del contexto: Postgres real (necesitan `TEST_DATABASE_URL`; sin ella se
//! omiten) y PokeAPI contra un servidor local.
#![allow(clippy::unwrap_used)]

#[path = "../support/mod.rs"]
mod support;

mod adapters {
    mod pg_dataset_loader;
    mod pg_etl_run_notifier;
    mod pg_etl_run_queue;
    mod pg_staging_store;
    mod pg_views_builder;
    mod poke_api_source;
    mod postgres;
}
