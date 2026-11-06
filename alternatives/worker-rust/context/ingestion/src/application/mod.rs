//! Aplicación: puertos y casos de uso del pipeline y de la cola de corridas.

pub mod errors;
pub mod ports;
pub mod use_cases;

pub use errors::{EnqueueError, GetRunError, RetryError};
