//! Filas del catálogo: lo que devuelve el scraper y se guarda en `staging`.

mod api;
mod catalog;
mod rows;

pub use api::{ApiNamedResource, ApiPokemon, ApiSprites, ApiTypeSlot};
pub use catalog::Dataset;
pub use rows::{PokemonRow, PokemonTypeRow, TypeRow};
