//! Variables de entorno del worker. Si el entorno es
//! inválido el worker no arranca.

use std::time::Duration;

use pokemon_data::pokeapi::{DEFAULT_BASE_URL, MAX_POKEMON};
use thiserror::Error;
use uuid::Uuid;

const DEFAULT_DATABASE_URL: &str = "postgresql://postgres:postgres@localhost:5451/pokemon";
/// El generador necesita al menos 2 Pokémon.
const MIN_POKEMON_LIMIT: u32 = 2;
const DEFAULT_POKEMON_LIMIT: u32 = 100;
const DEFAULT_LEASE_SECONDS: u64 = 30;
const DEFAULT_POLL_SECONDS: u64 = 5;
/// Plazo de cada paso: al vencer se cancela y la corrida se reintenta.
const STEP_DEADLINE: Duration = Duration::from_secs(300);

#[derive(Debug, Error, PartialEq, Eq)]
#[error("{variable}: {message}")]
pub struct ConfigError {
    pub variable: &'static str,
    pub message: String,
}

impl ConfigError {
    fn new(variable: &'static str, message: impl Into<String>) -> Self {
        Self {
            variable,
            message: message.into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Config {
    pub database_url: String,
    pub pokeapi_url: String,
    pub pokemon_limit: u32,
    pub worker_id: String,
    pub lease: Duration,
    pub poll: Duration,
    pub step_deadline: Duration,
}

/// `APP_ENV=production`: en producción no se lee ningún `.env`.
pub fn is_production(lookup: impl Fn(&str) -> Option<String>) -> bool {
    lookup("APP_ENV").as_deref() == Some("production")
}

/// Entero entre `min` y `max` desde `name`, o `default` si falta.
fn bounded(
    lookup: &impl Fn(&str) -> Option<String>,
    name: &'static str,
    default: u64,
    min: u64,
    max: u64,
) -> Result<u64, ConfigError> {
    match lookup(name) {
        None => Ok(default),
        Some(raw) => raw
            .trim()
            .parse::<u64>()
            .ok()
            .filter(|value| (min..=max).contains(value))
            .ok_or_else(|| {
                ConfigError::new(name, format!("debe ser un entero entre {min} y {max}"))
            }),
    }
}

/// `<hostname>:<pid>:<8 hex aleatorios>`, generado al arrancar.
fn default_worker_id() -> String {
    let host = std::env::var("HOSTNAME")
        .ok()
        .or_else(|| std::fs::read_to_string("/etc/hostname").ok())
        .map(|host| host.trim().to_owned())
        .filter(|host| !host.is_empty())
        .unwrap_or_else(|| "worker".into());
    let random = Uuid::new_v4().simple().to_string();
    format!("{host}:{}:{}", std::process::id(), &random[..8])
}

impl Config {
    /// Lee la configuración del entorno del proceso.
    ///
    /// # Errors
    ///
    /// Ver [`Config::from_lookup`].
    pub fn from_env() -> Result<Self, ConfigError> {
        Self::from_lookup(|name| std::env::var(name).ok())
    }

    /// Lee la configuración desde `lookup` (los tests no tocan el entorno real).
    ///
    /// # Errors
    ///
    /// Falla si alguna variable es inválida o vacía (`APP_ENV` incluida).
    pub fn from_lookup(lookup: impl Fn(&str) -> Option<String>) -> Result<Self, ConfigError> {
        // Igual que la API: un `APP_ENV` con un typo (p. ej. `prod`) no arranca.
        if let Some(env) = lookup("APP_ENV")
            && !matches!(env.as_str(), "development" | "production" | "test")
        {
            return Err(ConfigError::new(
                "APP_ENV",
                "debe ser development, production o test",
            ));
        }

        let non_empty = |name: &'static str, default: &str| -> Result<String, ConfigError> {
            let value = lookup(name).unwrap_or_else(|| default.to_owned());
            if value.trim().is_empty() {
                return Err(ConfigError::new(name, "no puede estar vacía"));
            }
            Ok(value)
        };

        let pokemon_limit = bounded(
            &lookup,
            "POKEMON_LIMIT",
            DEFAULT_POKEMON_LIMIT.into(),
            MIN_POKEMON_LIMIT.into(),
            MAX_POKEMON.into(),
        )?;
        let lease = bounded(&lookup, "LEASE_SECONDS", DEFAULT_LEASE_SECONDS, 1, 3600)?;
        let poll = bounded(&lookup, "POLL_SECONDS", DEFAULT_POLL_SECONDS, 1, 3600)?;

        Ok(Self {
            database_url: non_empty("DATABASE_URL", DEFAULT_DATABASE_URL)?,
            pokeapi_url: non_empty("POKEAPI_URL", DEFAULT_BASE_URL)?
                .trim_end_matches('/')
                .to_owned(),
            // El rango ya está validado: cabe en u32.
            pokemon_limit: u32::try_from(pokemon_limit).unwrap_or(DEFAULT_POKEMON_LIMIT),
            worker_id: match lookup("WORKER_ID") {
                Some(id) if id.trim().is_empty() => {
                    return Err(ConfigError::new("WORKER_ID", "no puede estar vacío"));
                }
                Some(id) => id,
                None => default_worker_id(),
            },
            lease: Duration::from_secs(lease),
            poll: Duration::from_secs(poll),
            step_deadline: STEP_DEADLINE,
        })
    }
}
