use std::sync::Arc;

use uuid::Uuid;

use crate::application::GetRunError;
use crate::application::ports::EtlRunQueue;
use crate::domain::EtlRun;

/// `GET /etl/runs/:runId`.
pub struct GetRun {
    queue: Arc<dyn EtlRunQueue>,
}

impl GetRun {
    pub fn new(queue: Arc<dyn EtlRunQueue>) -> Self {
        Self { queue }
    }

    pub async fn execute(&self, run_id: Uuid) -> Result<EtlRun, GetRunError> {
        self.queue
            .get(run_id)
            .await?
            .ok_or(GetRunError::NotFound(run_id))
    }
}
