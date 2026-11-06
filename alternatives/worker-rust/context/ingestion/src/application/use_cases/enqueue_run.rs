use std::sync::Arc;

use crate::application::EnqueueError;
use crate::application::ports::EtlRunQueue;
use crate::domain::EtlRun;

/// `POST /etl/runs`: encola una corrida o devuelve la que ya está en cola o corriendo.
pub struct EnqueueRun {
    queue: Arc<dyn EtlRunQueue>,
}

impl EnqueueRun {
    pub fn new(queue: Arc<dyn EtlRunQueue>) -> Self {
        Self { queue }
    }

    pub async fn execute(&self) -> Result<EtlRun, EnqueueError> {
        self.queue.enqueue().await
    }
}
