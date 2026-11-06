use async_trait::async_trait;
use pokemon_data::dataset::Dataset;
use pokemon_data::pokeapi::PokeApiError;

/// Origen del catálogo (PokeAPI).
#[async_trait]
pub trait PokemonSource: Send + Sync {
    /// Los Pokémon `1..=limit` con sus tipos, ya ordenados.
    async fn scrape(&self, limit: u32) -> Result<Dataset, PokeApiError>;
}
