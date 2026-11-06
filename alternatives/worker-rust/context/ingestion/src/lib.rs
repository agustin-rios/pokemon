//! Contexto `ingestion`: el pipeline `scrape → generate → validate → load →
//! build_views`, la cola de corridas (Postgres) y su procesador.
//!
//! Capas: `domain` → `application` (puertos y casos de uso) → `infra`.

pub mod application;
pub mod domain;
pub mod infra;
