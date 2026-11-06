use std::time::Duration;

use async_trait::async_trait;
use uuid::Uuid;

/// Aviso de que hay una corrida en cola (`LISTEN etl_runs`).
#[async_trait]
pub trait RunNotifier: Send + Sync {
    /// Espera un aviso hasta `timeout`. Devuelve el id de la corrida avisada, o
    /// `None` si venció el plazo o se cayó la conexión (se reconecta sola).
    /// Un aviso solo significa "intentá tomar una corrida": no es una garantía.
    async fn wait(&self, timeout: Duration) -> Option<Uuid>;
}
