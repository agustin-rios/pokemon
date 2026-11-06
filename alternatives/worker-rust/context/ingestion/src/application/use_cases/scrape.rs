use std::sync::Arc;

use serde_json::json;

use super::step_outcome::StepOutcome;
use crate::application::ports::{CommitOutcome, Fence, PokemonSource, StagingStore};
use crate::domain::StepError;

/// Paso `scrape`: baja los Pokémon `1..=limit` y reemplaza `staging.types`,
/// `staging.pokemon` y `staging.pokemon_types` en una transacción. Si el future se
/// abandona (cancelación o plazo) no escribe nada.
pub struct ScrapeCatalog {
    source: Arc<dyn PokemonSource>,
    staging: Arc<dyn StagingStore>,
    limit: u32,
}

impl ScrapeCatalog {
    pub fn new(source: Arc<dyn PokemonSource>, staging: Arc<dyn StagingStore>, limit: u32) -> Self {
        Self {
            source,
            staging,
            limit,
        }
    }

    pub async fn execute(&self, fence: &Fence) -> Result<StepOutcome, StepError> {
        let catalog = self.source.scrape(self.limit).await?;
        Ok(
            match self.staging.replace_catalog(&catalog, Some(fence)).await? {
                CommitOutcome::Committed => StepOutcome::Done(Some(json!({
                    "pokemon": catalog.pokemon.len(),
                    "types": catalog.types.len(),
                    "pokemonTypes": catalog.pokemon_types.len(),
                }))),
                CommitOutcome::LeaseLost => StepOutcome::LeaseLost,
            },
        )
    }
}
