//! Puertos: contratos que implementa la infraestructura.

mod pokemon_repository;
mod reports_repository;

pub use pokemon_repository::{Page, PageQuery, PokemonRepository};
pub use reports_repository::ReportsRepository;
