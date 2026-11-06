use thiserror::Error;

use super::MAX_POKEMON;

/// Último intento que falló, para el detalle de [`PokeApiError::Exhausted`].
#[derive(Debug, Error)]
pub enum AttemptFailure {
    #[error("error de red: {0}")]
    Network(#[from] reqwest::Error),
    #[error("HTTP {0}")]
    Status(u16),
}

#[derive(Debug, Error)]
pub enum PokeApiError {
    /// Respuesta no recuperable (cualquier no-2xx salvo 429 y 5xx): no se reintenta.
    #[error("GET {url} respondió HTTP {status}")]
    Status { url: String, status: u16 },
    /// Se agotaron los intentos con errores recuperables (red, timeout, 429, 5xx).
    #[error("GET {url} falló tras {attempts} intentos")]
    Exhausted {
        url: String,
        attempts: u32,
        #[source]
        last: AttemptFailure,
    },
    /// Respuesta 2xx cuyo cuerpo no tiene la forma esperada.
    #[error("GET {url} devolvió una respuesta inválida")]
    Decode {
        url: String,
        #[source]
        source: serde_json::Error,
    },
    #[error("URL de tipo inesperada: {0}")]
    UnexpectedTypeUrl(String),
    #[error("limit debe estar entre 0 y {MAX_POKEMON}")]
    InvalidLimit,
}
