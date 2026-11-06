//! Procesador del ETL: el bucle del worker. Toma una corrida, la ejecuta y vuelve a
//! empezar; sin corridas, espera un aviso (NOTIFY) o el sondeo, lo que ocurra primero.

use std::future::Future;
use std::pin::pin;
use std::time::Duration;

use async_trait::async_trait;
use pokemon_context_ingestion::application::ports::RunNotifier;
use pokemon_context_ingestion::application::use_cases::{ProcessOutcome, ProcessRun};
use pokemon_context_ingestion::domain::StorageError;
use tokio::time::timeout;
use tracing::{error, info, warn};

/// Lo que el bucle necesita del caso de uso que procesa corridas.
#[async_trait]
pub trait ProcessNext: Send + Sync {
    async fn process_next(&self) -> Result<ProcessOutcome, StorageError>;

    /// Apagado: el paso en curso termina, no se inicia otro y no se toman corridas.
    fn request_stop(&self);

    /// Devuelve a la cola la corrida cuyo `process_next` se abandonó.
    async fn release_abandoned(&self) -> Result<(), StorageError>;
}

#[async_trait]
impl ProcessNext for ProcessRun {
    async fn process_next(&self) -> Result<ProcessOutcome, StorageError> {
        ProcessRun::process_next(self).await
    }

    fn request_stop(&self) {
        ProcessRun::request_stop(self);
    }

    async fn release_abandoned(&self) -> Result<(), StorageError> {
        ProcessRun::release_abandoned(self).await.map(|_| ())
    }
}

/// Plazo para devolver la corrida abandonada a la cola.
const RELEASE_TIMEOUT: Duration = Duration::from_secs(3);

/// Parámetros del bucle.
#[derive(Debug, Clone, Copy)]
pub struct RunnerConfig {
    /// Espera máxima entre intentos de tomar una corrida si no llega un aviso.
    pub poll: Duration,
    /// Tiempo que se le da al paso en curso para terminar al apagar; pasado ese
    /// plazo se abandona y la corrida se devuelve a la cola.
    pub shutdown_grace: Duration,
}

/// Corre hasta que `shutdown` se cumple. Una sola corrida a la vez.
///
/// Tomar una corrida (`process_next`) puede ejecutarla entera: si el apagado
/// llega mientras tanto, se pide detenerse (el paso en curso termina y la corrida
/// vuelve a la cola) y se le dan `shutdown_grace`; pasado ese plazo se abandona
/// el paso y se devuelve la corrida a la cola. Un aviso solo significa "intenta tomar una corrida": si el intento
/// no encuentra nada, el worker vuelve a esperar (sin busy loop).
pub async fn run(
    processor: &dyn ProcessNext,
    notifier: &dyn RunNotifier,
    config: RunnerConfig,
    shutdown: impl Future<Output = ()>,
) {
    let mut shutdown = pin!(shutdown);
    loop {
        let mut work = pin!(processor.process_next());
        let result = tokio::select! {
            result = &mut work => result,
            () = &mut shutdown => {
                info!(
                    "apagando: se espera hasta {} s a que termine la corrida en curso",
                    config.shutdown_grace.as_secs()
                );
                processor.request_stop();
                match timeout(config.shutdown_grace, &mut work).await {
                    Ok(result) => {
                        finish(result);
                    }
                    Err(_) => {
                        warn!("se abandona el paso en curso y la corrida vuelve a la cola");
                        match timeout(RELEASE_TIMEOUT, processor.release_abandoned()).await {
                            Ok(Ok(())) => {}
                            Ok(Err(e)) => error!("no se pudo devolver la corrida a la cola: {e}"),
                            Err(_) => error!("la base no respondió: el lease de la corrida vencerá solo"),
                        }
                    }
                }
                return;
            }
        };

        if finish(result) {
            continue;
        }
        tokio::select! {
            _ = notifier.wait(config.poll) => {}
            () = &mut shutdown => return,
        }
    }
}

/// Registra el resultado. `true` si se procesó una corrida (hay que volver a
/// intentar de inmediato); `false` si no había nada o falló el acceso a la cola.
fn finish(result: Result<ProcessOutcome, StorageError>) -> bool {
    match result {
        Ok(ProcessOutcome::Idle) => false,
        // `ProcessRun` ya registró cómo terminó la corrida.
        Ok(_) => true,
        Err(e) => {
            error!("no se pudo procesar la cola: {e}");
            false
        }
    }
}
