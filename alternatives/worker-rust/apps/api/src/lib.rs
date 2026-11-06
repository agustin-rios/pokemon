//! API HTTP del proyecto (axum): catálogo, reportes y corridas del pipeline.
//! Compone los casos de uso de los contextos; no tiene lógica propia.

pub mod app_module;
pub mod app_setup;
pub mod common;
pub mod config;
pub mod modules;
pub mod types;

pub use app_module::app_module;
pub use app_setup::app_setup;
