//! Worker: espera corridas en la cola, toma una y ejecuta el pipeline. Compone
//! los casos de uso del contexto `ingestion` con sus adaptadores.

pub mod app_module;
pub mod config;
pub mod modules;

pub use app_module::{AppModule, AppModuleError};
