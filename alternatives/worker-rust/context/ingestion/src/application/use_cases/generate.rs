use std::sync::Arc;

use pokemon_data::generator::{GeneratorOptions, generate};
use serde_json::json;

use super::step_outcome::StepOutcome;
use crate::application::ports::{CommitOutcome, Fence, StagingStore};
use crate::domain::StepError;

/// Paso `generate`: con los ids de `staging.pokemon` genera entrenadores, capturas y
/// combates y reemplaza `staging.trainers`, `staging.captures` y `staging.battles` en una
/// transacción.
pub struct GenerateData {
    staging: Arc<dyn StagingStore>,
}

impl GenerateData {
    pub fn new(staging: Arc<dyn StagingStore>) -> Self {
        Self { staging }
    }

    pub async fn execute(&self, fence: &Fence) -> Result<StepOutcome, StepError> {
        let ids = self.staging.pokemon_ids().await?;
        if ids.len() < 2 {
            return Err(StepError::NotEnoughPokemon);
        }

        let generated = generate(&ids, &GeneratorOptions::default())?;
        Ok(
            match self
                .staging
                .replace_generated(&generated, Some(fence))
                .await?
            {
                CommitOutcome::Committed => StepOutcome::Done(Some(json!({
                    "trainers": generated.trainers.len(),
                    "captures": generated.captures.len(),
                    "battles": generated.battles.len(),
                }))),
                CommitOutcome::LeaseLost => StepOutcome::LeaseLost,
            },
        )
    }
}
