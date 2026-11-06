//! Variables de entorno de la API (`APP_ENV`, `PORT`, `DATABASE_URL`,
//! `CORS_ALLOW_ORIGINS`). Si el entorno es inválido la API no arranca.

use thiserror::Error;

/// Base de datos de la app. Default: el Postgres de docker compose en dev.
const DEFAULT_DATABASE_URL: &str = "postgresql://postgres:postgres@localhost:5451/pokemon";
const DEFAULT_PORT: u16 = 3000;

/// Entorno de ejecución (`APP_ENV`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AppEnv {
    Development,
    Production,
    Test,
}

/// Orígenes que acepta CORS.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CorsOrigins {
    /// `*`: se refleja el origen de cada request.
    Any,
    List(Vec<String>),
}

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
    pub app_env: AppEnv,
    pub port: u16,
    pub database_url: String,
    pub cors_allow_origins: CorsOrigins,
}

/// `APP_ENV` (default `development`).
///
/// # Errors
///
/// Falla si el valor no es `development`, `production` ni `test`.
pub fn app_env(lookup: impl Fn(&str) -> Option<String>) -> Result<AppEnv, ConfigError> {
    match lookup("APP_ENV").as_deref() {
        None | Some("development") => Ok(AppEnv::Development),
        Some("production") => Ok(AppEnv::Production),
        Some("test") => Ok(AppEnv::Test),
        Some(_) => Err(ConfigError::new(
            "APP_ENV",
            "debe ser development, production o test",
        )),
    }
}

/// `PORT` (default 3000): entero entre 1 y 65535.
///
/// # Errors
///
/// Falla si el valor no es un puerto válido.
pub fn port(lookup: impl Fn(&str) -> Option<String>) -> Result<u16, ConfigError> {
    match lookup("PORT") {
        None => Ok(DEFAULT_PORT),
        Some(raw) => raw
            .trim()
            .parse::<u16>()
            .ok()
            .filter(|port| *port > 0)
            .ok_or_else(|| ConfigError::new("PORT", "debe ser un entero entre 1 y 65535")),
    }
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
    /// Falla si alguna variable es inválida o si se pide `CORS_ALLOW_ORIGINS=*`
    /// en producción.
    pub fn from_lookup(lookup: impl Fn(&str) -> Option<String>) -> Result<Self, ConfigError> {
        let app_env = app_env(&lookup)?;
        let port = port(&lookup)?;

        let database_url = lookup("DATABASE_URL").unwrap_or_else(|| DEFAULT_DATABASE_URL.into());
        if database_url.is_empty() {
            return Err(ConfigError::new("DATABASE_URL", "no puede estar vacía"));
        }

        let raw_origins = lookup("CORS_ALLOW_ORIGINS").unwrap_or_else(|| "*".into());
        let cors_allow_origins = if raw_origins == "*" {
            CorsOrigins::Any
        } else {
            CorsOrigins::List(
                raw_origins
                    .split(',')
                    .map(str::trim)
                    .filter(|origin| !origin.is_empty())
                    .map(str::to_owned)
                    .collect(),
            )
        };
        if app_env == AppEnv::Production && cors_allow_origins == CorsOrigins::Any {
            return Err(ConfigError::new(
                "CORS_ALLOW_ORIGINS",
                "en producción no se permite \"*\"",
            ));
        }

        Ok(Self {
            app_env,
            port,
            database_url,
            cors_allow_origins,
        })
    }
}
