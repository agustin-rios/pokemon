use async_trait::async_trait;
use uuid::Uuid;

use super::claimed_run::ClaimedRun;
use super::failure_outcome::FailureOutcome;
use super::fence::Fence;
use crate::application::{EnqueueError, RetryError};
use crate::domain::{EtlRun, StepName, StorageError};

/// Cola de corridas. Las operaciones con `Fence` devuelven `false` (o
/// `LeaseLost`) cuando el lease se perdió: no es un error, el worker solo
/// debe dejar de ejecutar y no escribir nada más.
#[async_trait]
pub trait EtlRunQueue: Send + Sync {
    /// Crea una corrida con sus 5 pasos, o devuelve la que ya está en cola o corriendo.
    async fn enqueue(&self) -> Result<EtlRun, EnqueueError>;

    async fn get(&self, run_id: Uuid) -> Result<Option<EtlRun>, StorageError>;

    /// Vuelve a encolar una corrida fallida; retoma desde el paso fallido.
    async fn retry(&self, run_id: Uuid) -> Result<EtlRun, RetryError>;

    /// Marca como fallidas las corridas muertas sin intentos y toma la más
    /// antigua disponible (en cola, o con el lease vencido y intentos restantes).
    async fn claim(
        &self,
        worker_id: &str,
        lease_seconds: f64,
    ) -> Result<Option<ClaimedRun>, StorageError>;

    /// Extiende el lease. `false` si se perdió.
    async fn heartbeat(&self, fence: &Fence, lease_seconds: f64) -> Result<bool, StorageError>;

    /// Pone el paso en ejecución. `false` si se perdió el lease.
    async fn start_step(&self, fence: &Fence, step: StepName) -> Result<bool, StorageError>;

    /// Marca el paso como exitoso con su resumen. `false` si se perdió el lease.
    async fn finish_step(
        &self,
        fence: &Fence,
        step: StepName,
        output: Option<&serde_json::Value>,
    ) -> Result<bool, StorageError>;

    /// Marca la corrida como exitosa. `false` si se perdió el lease.
    async fn complete_run(&self, fence: &Fence) -> Result<bool, StorageError>;

    /// Registra el fallo del paso y decide el destino de la corrida: de nuevo a
    /// la cola si `retryable` y quedan intentos, fallida en otro caso.
    async fn fail_step(
        &self,
        fence: &Fence,
        step: StepName,
        message: &str,
        retryable: bool,
    ) -> Result<FailureOutcome, StorageError>;

    /// Devuelve la corrida a la cola de inmediato y sin gastar el intento (para
    /// apagar el worker sin que el relevo espere a que venza el lease). El paso en
    /// ejecución vuelve a `pending`. `false` si se perdió el lease.
    async fn release(&self, fence: &Fence) -> Result<bool, StorageError>;
}
