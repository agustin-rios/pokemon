//! Configuración de la API desde variables de entorno.

pub mod env;

pub use env::{AppEnv, Config, ConfigError, CorsOrigins, app_env, port};
