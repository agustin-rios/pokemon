//! Errores del pipeline y su clasificación en permanentes o reintentables.

use std::time::Duration;

use pokemon_data::generator::GeneratorError;
use pokemon_data::pokeapi::PokeApiError;
use thiserror::Error;

use super::dataset::DataValidationError;
use super::run::StepName;

/// Fallo de la base de datos o de la cola, sin atarse al driver. Conserva el
/// SQLSTATE (si lo hay) para clasificar el error.
#[derive(Debug, Error)]
#[error("error de base de datos: {source}")]
pub struct StorageError {
    /// Código SQLSTATE; `None` en errores sin código (conexión rechazada, timeouts, IO).
    pub sqlstate: Option<String>,
    #[source]
    pub source: Box<dyn std::error::Error + Send + Sync>,
}

/// Error de un paso del pipeline.
#[derive(Debug, Error)]
pub enum StepError {
    #[error(transparent)]
    Validation(#[from] DataValidationError),
    #[error("se necesitan al menos 2 Pokémon en staging.pokemon")]
    NotEnoughPokemon,
    #[error(transparent)]
    Source(#[from] PokeApiError),
    #[error(transparent)]
    Generator(#[from] GeneratorError),
    #[error(transparent)]
    Storage(#[from] StorageError),
    /// El paso superó su plazo y se cancela sin escribir nada.
    #[error("el paso superó el plazo de {} s", .0.as_secs())]
    Timeout(Duration),
}

/// Si volver a intentar el paso puede servir.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorClass {
    Permanent,
    Retryable,
}

impl ErrorClass {
    pub fn is_retryable(self) -> bool {
        self == Self::Retryable
    }
}

/// Clasifica el error de `step`. Permanentes: datos inválidos, menos de 2 Pokémon,
/// HTTP que no es 429 ni 5xx, URL de tipo inesperada, SQLSTATE de clase `22` o
/// `23` y de clase `42` en `build_views`. El resto (red, timeouts, plazo del paso,
/// clases 08/40/53/57, intentos agotados) es reintentable.
pub fn classify(step: StepName, error: &StepError) -> ErrorClass {
    match error {
        StepError::Validation(_) | StepError::NotEnoughPokemon | StepError::Generator(_) => {
            ErrorClass::Permanent
        }
        StepError::Source(source) => match source {
            PokeApiError::Status { .. }
            | PokeApiError::UnexpectedTypeUrl(_)
            | PokeApiError::InvalidLimit => ErrorClass::Permanent,
            PokeApiError::Exhausted { .. } | PokeApiError::Decode { .. } => ErrorClass::Retryable,
        },
        StepError::Timeout(_) => ErrorClass::Retryable,
        StepError::Storage(storage) => classify_sqlstate(step, storage.sqlstate.as_deref()),
    }
}

fn classify_sqlstate(step: StepName, sqlstate: Option<&str>) -> ErrorClass {
    match sqlstate.and_then(|code| code.get(..2)) {
        Some("22" | "23") => ErrorClass::Permanent,
        Some("42") if step == StepName::BuildViews => ErrorClass::Permanent,
        _ => ErrorClass::Retryable,
    }
}
