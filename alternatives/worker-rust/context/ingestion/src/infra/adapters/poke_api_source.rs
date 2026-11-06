use async_trait::async_trait;
use pokemon_data::dataset::Dataset;
use pokemon_data::pokeapi::{PokeApiClient, PokeApiError};

use crate::application::ports::PokemonSource;

/// PokeAPI a través del cliente de `pokemon-data`.
pub struct PokeApiSource {
    client: PokeApiClient,
}

impl PokeApiSource {
    pub fn new(client: PokeApiClient) -> Self {
        Self { client }
    }
}

#[async_trait]
impl PokemonSource for PokeApiSource {
    async fn scrape(&self, limit: u32) -> Result<Dataset, PokeApiError> {
        self.client.scrape(limit).await
    }
}
