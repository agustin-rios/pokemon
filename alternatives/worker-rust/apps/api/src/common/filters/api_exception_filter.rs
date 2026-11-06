//! Filtro de excepciones: convierte los errores de los casos de uso en la respuesta
//! HTTP con el cuerpo de Nest, `{message, error, statusCode}`.

use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use pokemon_context_ingestion::application::{EnqueueError, GetRunError, RetryError};
use pokemon_context_pokedex::application::{PokedexError, RepositoryError};
use serde::Serialize;
use tracing::error;

#[derive(Debug, PartialEq, Eq)]
pub enum ApiError {
    BadRequest(String),
    NotFound(String),
    Conflict(String),
    ServiceUnavailable(String),
    /// El detalle se registra en el log; al cliente solo le llega el texto genérico.
    Internal,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorBody<'a> {
    message: &'a str,
    error: &'a str,
    status_code: u16,
}

impl ApiError {
    fn parts(&self) -> (StatusCode, &'static str, &str) {
        match self {
            Self::BadRequest(message) => (StatusCode::BAD_REQUEST, "Bad Request", message),
            Self::NotFound(message) => (StatusCode::NOT_FOUND, "Not Found", message),
            Self::Conflict(message) => (StatusCode::CONFLICT, "Conflict", message),
            Self::ServiceUnavailable(message) => (
                StatusCode::SERVICE_UNAVAILABLE,
                "Service Unavailable",
                message,
            ),
            Self::Internal => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Internal Server Error",
                "Internal server error",
            ),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, error, message) = self.parts();
        let body = ErrorBody {
            message,
            error,
            status_code: status.as_u16(),
        };
        (status, Json(body)).into_response()
    }
}

/// Registra el error interno y responde 500 sin exponer el detalle.
fn internal(error: &dyn std::error::Error) -> ApiError {
    error!("error interno: {error}");
    ApiError::Internal
}

impl From<RepositoryError> for ApiError {
    fn from(err: RepositoryError) -> Self {
        match err {
            RepositoryError::DataNotLoaded => Self::ServiceUnavailable(err.to_string()),
            RepositoryError::Storage(_) => internal(&err),
        }
    }
}

impl From<PokedexError> for ApiError {
    fn from(err: PokedexError) -> Self {
        match err {
            PokedexError::Validation(e) => Self::BadRequest(e.to_string()),
            PokedexError::Repository(e) => e.into(),
        }
    }
}

impl From<EnqueueError> for ApiError {
    fn from(err: EnqueueError) -> Self {
        internal(&err)
    }
}

impl From<GetRunError> for ApiError {
    fn from(err: GetRunError) -> Self {
        match err {
            GetRunError::NotFound(_) => Self::NotFound(err.to_string()),
            GetRunError::Storage(_) => internal(&err),
        }
    }
}

impl From<RetryError> for ApiError {
    fn from(err: RetryError) -> Self {
        match err {
            RetryError::NotFound(_) => Self::NotFound(err.to_string()),
            RetryError::NotFailed | RetryError::AlreadyActive => Self::Conflict(err.to_string()),
            RetryError::Storage(_) => internal(&err),
        }
    }
}
