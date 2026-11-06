use std::sync::Arc;

use serde_json::json;

use super::step_outcome::StepOutcome;
use super::validate::read_validated;
use crate::application::ports::{CommitOutcome, DatasetLoader, Fence, StagingStore};
use crate::domain::StepError;

/// Paso `load`: vuelve a leer y validar `staging` (lo que se carga es exactamente lo
/// validado) y reemplaza las 6 tablas finales en una transacción.
pub struct LoadDataset {
    staging: Arc<dyn StagingStore>,
    loader: Arc<dyn DatasetLoader>,
}

impl LoadDataset {
    pub fn new(staging: Arc<dyn StagingStore>, loader: Arc<dyn DatasetLoader>) -> Self {
        Self { staging, loader }
    }

    pub async fn execute(&self, fence: &Fence) -> Result<StepOutcome, StepError> {
        let report = read_validated(self.staging.as_ref()).await?;
        Ok(match self.loader.load(&report, Some(fence)).await? {
            CommitOutcome::Committed => StepOutcome::Done(Some(json!({"counts": report.counts}))),
            CommitOutcome::LeaseLost => StepOutcome::LeaseLost,
        })
    }
}
