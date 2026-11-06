use std::sync::Arc;

use serde_json::{Value, json};
use tracing::warn;

use crate::application::ports::StagingStore;
use crate::domain::{StepError, ValidationReport, validate_dataset};

/// Máximo de filas descartadas que se escriben en el log por tabla.
const MAX_DISCARDED_LOGGED: usize = 20;

/// Lee las 6 tablas de `staging` y las valida; informa en el log las filas descartadas.
pub(super) async fn read_validated(
    staging: &dyn StagingStore,
) -> Result<ValidationReport, StepError> {
    let report = validate_dataset(&staging.read_all().await?)?;
    for (table, reasons) in &report.discarded {
        warn!("{table}: {} fila(s) descartada(s)", reasons.len());
        for reason in reasons.iter().take(MAX_DISCARDED_LOGGED) {
            warn!("  {reason}");
        }
    }
    Ok(report)
}

/// Paso `validate`: valida `staging` sin escribir nada.
pub struct ValidateDataset {
    staging: Arc<dyn StagingStore>,
}

impl ValidateDataset {
    pub fn new(staging: Arc<dyn StagingStore>) -> Self {
        Self { staging }
    }

    pub async fn execute(&self) -> Result<Value, StepError> {
        let report = read_validated(self.staging.as_ref()).await?;
        Ok(json!({"counts": report.counts, "discarded": report.discarded}))
    }
}
