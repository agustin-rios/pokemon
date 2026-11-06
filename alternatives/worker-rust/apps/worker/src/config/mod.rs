//! Configuración del worker desde variables de entorno.

pub mod env;

pub use env::{Config, ConfigError, is_production};
