use std::sync::Arc;

use uuid::Uuid;

use crate::application::RetryError;
use crate::application::ports::EtlRunQueue;
use crate::domain::EtlRun;

/// `POST /etl/runs/:runId/retry`: la corrida retoma desde el paso fallido.
pub struct RetryRun {
    queue: Arc<dyn EtlRunQueue>,
}

impl RetryRun {
    pub fn new(queue: Arc<dyn EtlRunQueue>) -> Self {
        Self { queue }
    }

    pub async fn execute(&self, run_id: Uuid) -> Result<EtlRun, RetryError> {
        self.queue.retry(run_id).await
    }
}
