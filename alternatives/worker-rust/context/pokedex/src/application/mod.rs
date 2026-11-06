//! Capa de aplicación: errores, puertos y casos de uso.

mod errors;
pub mod ports;
pub mod use_cases;

pub use errors::{PokedexError, RepositoryError, ValidationError};
