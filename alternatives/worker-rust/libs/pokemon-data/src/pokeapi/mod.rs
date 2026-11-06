//! Cliente de PokeAPI (port del cliente TypeScript del proyecto principal).
//!
//! Trae `GET {base}/pokemon/{1..limit}` con concurrencia acotada, timeout por petición y
//! reintentos con espera exponencial (o `Retry-After`) solo para errores recuperables.

mod client;
mod config;
mod error;
mod type_url;

/// URL base de la PokeAPI pública.
pub const DEFAULT_BASE_URL: &str = "https://pokeapi.co/api/v2";

/// Cantidad máxima de Pokémon que sirve la API.
pub const MAX_POKEMON: u32 = 1025;

pub use client::PokeApiClient;
pub use config::ClientConfig;
pub use error::{AttemptFailure, PokeApiError};
pub use type_url::type_id_from_url;
