use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, PoisonError};

use pokemon_data::errors::error_chain;
use tokio::time::{Instant, MissedTickBehavior, interval_at, timeout, timeout_at};
use tracing::{error, info, warn};
use uuid::Uuid;

use super::{Pipeline, ProcessOutcome, ProcessRunConfig, StepOutcome};
use crate::application::ports::{ClaimedRun, EtlRunQueue, FailureOutcome, Fence};
use crate::domain::{StepError, StepName, StepState, StorageError, classify};

/// Cómo terminó la ejecución de los pasos de una corrida tomada.
enum Finish {
    Succeeded,
    Failed,
    Requeued,
    LeaseLost,
    Stopped,
}

/// Toma la próxima corrida y ejecuta sus pasos en orden, saltando los que ya
/// están `succeeded` (retoma desde donde quedó). Una sola corrida a la vez.
pub struct ProcessRun {
    queue: Arc<dyn EtlRunQueue>,
    pipeline: Pipeline,
    config: ProcessRunConfig,
    /// Se pidió apagar: no se inicia ningún paso más.
    stop: AtomicBool,
    /// Corrida tomada que aún no terminó; si el futuro se abandona, sigue aquí.
    current: Mutex<Option<Fence>>,
}

impl ProcessRun {
    pub fn new(queue: Arc<dyn EtlRunQueue>, pipeline: Pipeline, config: ProcessRunConfig) -> Self {
        Self {
            queue,
            pipeline,
            config,
            stop: AtomicBool::new(false),
            current: Mutex::new(None),
        }
    }

    /// Pide detenerse: el paso en curso termina, no se inicia otro y la corrida
    /// vuelve a la cola. No se toman más corridas.
    pub fn request_stop(&self) {
        self.stop.store(true, Ordering::SeqCst);
    }

    /// Devuelve a la cola la corrida cuyo futuro se abandonó (por ejemplo al
    /// vencer el plazo de apagado), sin gastar un intento, para que otro worker
    /// no espere a que venza el lease. `None` si no había ninguna.
    ///
    /// # Errors
    ///
    /// Falla si la cola no responde; el lease vence solo y la corrida se retoma.
    pub async fn release_abandoned(&self) -> Result<Option<Uuid>, StorageError> {
        let Some(fence) = self.set_current(None) else {
            return Ok(None);
        };
        if self.queue.release(&fence).await? {
            info!("corrida {}: se devolvió a la cola", fence.run_id);
        }
        Ok(Some(fence.run_id))
    }

    fn set_current(&self, fence: Option<Fence>) -> Option<Fence> {
        std::mem::replace(
            &mut *self.current.lock().unwrap_or_else(PoisonError::into_inner),
            fence,
        )
    }

    /// Intenta tomar una corrida y la ejecuta hasta terminarla. Es seguro
    /// cancelar el futuro (por ejemplo en un apagado): el lease vence y otro
    /// worker retoma la corrida (o antes, con [`Self::release_abandoned`]).
    ///
    /// # Errors
    ///
    /// Falla si la cola no responde al tomar o registrar la corrida; en ese
    /// caso el lease vence solo y la corrida se retoma.
    pub async fn process_next(&self) -> Result<ProcessOutcome, StorageError> {
        let lease_seconds = self.config.lease.as_secs_f64();
        if self.stop.load(Ordering::SeqCst) {
            return Ok(ProcessOutcome::Idle);
        }
        let Some(claimed) = self
            .queue
            .claim(&self.config.worker_id, lease_seconds)
            .await?
        else {
            return Ok(ProcessOutcome::Idle);
        };
        self.set_current(Some(claimed.fence.clone()));
        let run_id = claimed.fence.run_id;
        info!(
            "corrida {run_id} tomada por {} (intento {}/{})",
            self.config.worker_id, claimed.fence.attempts, claimed.max_attempts
        );

        // Si el heartbeat pierde el lease, soltar el futuro de los pasos es la
        // cancelación: deja de ejecutar y no escribe nada más.
        let finish = tokio::select! {
            biased;
            () = self.watch_lease(&claimed.fence) => Finish::LeaseLost,
            result = self.run_steps(&claimed) => result?,
        };
        self.set_current(None);
        if matches!(finish, Finish::Stopped) {
            self.queue.release(&claimed.fence).await?;
            info!("corrida {run_id}: apagado, vuelve a la cola");
        }
        Ok(match finish {
            Finish::Succeeded => {
                info!("corrida {run_id} terminada");
                ProcessOutcome::Succeeded(run_id)
            }
            Finish::Requeued => ProcessOutcome::Requeued(run_id),
            Finish::Failed => ProcessOutcome::Failed(run_id),
            Finish::Stopped => ProcessOutcome::Stopped(run_id),
            Finish::LeaseLost => {
                warn!("corrida {run_id}: se perdió el lease, se deja de ejecutar");
                ProcessOutcome::LeaseLost(run_id)
            }
        })
    }

    /// Renueva el lease cada tercio de su duración. Termina (y por lo tanto
    /// cancela la ejecución) cuando se pierde: la base responde 0 filas o,
    /// ante errores repetidos, el plazo que se conoce localmente ya pasó.
    async fn watch_lease(&self, fence: &Fence) {
        let lease = self.config.lease;
        let period = lease / 3;
        let mut deadline = Instant::now() + lease;
        let mut ticker = interval_at(Instant::now() + period, period);
        ticker.set_missed_tick_behavior(MissedTickBehavior::Delay);
        loop {
            ticker.tick().await;
            // Sin respuesta de la base el plazo local manda: no se espera más allá de él.
            match timeout_at(deadline, self.queue.heartbeat(fence, lease.as_secs_f64())).await {
                Ok(Ok(true)) => deadline = Instant::now() + lease,
                Ok(Ok(false)) => return,
                Ok(Err(e)) => {
                    error!("heartbeat de la corrida {} falló: {e}", fence.run_id);
                    if Instant::now() >= deadline {
                        return;
                    }
                }
                Err(_) => {
                    error!(
                        "heartbeat de la corrida {} sin respuesta antes de vencer el lease",
                        fence.run_id
                    );
                    return;
                }
            }
        }
    }

    async fn run_steps(&self, claimed: &ClaimedRun) -> Result<Finish, StorageError> {
        let fence = &claimed.fence;
        let Some(run) = self.queue.get(fence.run_id).await? else {
            return Ok(Finish::LeaseLost);
        };

        for step in StepName::ALL {
            if run.step_state(step) == Some(StepState::Succeeded) {
                info!("paso {step}: ya estaba terminado, se salta");
                continue;
            }
            if self.stop.load(Ordering::SeqCst) {
                return Ok(Finish::Stopped);
            }
            if !self.queue.start_step(fence, step).await? {
                return Ok(Finish::LeaseLost);
            }
            info!("paso {step}: iniciado");

            let executed = match timeout(
                self.config.step_deadline,
                self.pipeline.execute(step, fence),
            )
            .await
            {
                Ok(result) => result,
                Err(_) => Err(StepError::Timeout(self.config.step_deadline)),
            };
            match executed {
                Ok(StepOutcome::Done(output)) => {
                    if !self.queue.finish_step(fence, step, output.as_ref()).await? {
                        return Ok(Finish::LeaseLost);
                    }
                    match output {
                        Some(output) => info!("paso {step}: terminado {output}"),
                        None => info!("paso {step}: terminado"),
                    }
                }
                Ok(StepOutcome::LeaseLost) => return Ok(Finish::LeaseLost),
                Err(e) => {
                    let class = classify(step, &e);
                    let kind = if class.is_retryable() {
                        "reintentable"
                    } else {
                        "permanente"
                    };
                    error!("paso {step}: falló ({kind}): {}", error_chain(&e));
                    let outcome = self
                        .queue
                        .fail_step(fence, step, &e.to_string(), class.is_retryable())
                        .await?;
                    return Ok(match outcome {
                        FailureOutcome::Requeued => {
                            warn!("corrida {}: vuelve a la cola para reintentar", fence.run_id);
                            Finish::Requeued
                        }
                        FailureOutcome::Failed => Finish::Failed,
                        FailureOutcome::LeaseLost => Finish::LeaseLost,
                    });
                }
            }
        }

        if self.queue.complete_run(fence).await? {
            Ok(Finish::Succeeded)
        } else {
            Ok(Finish::LeaseLost)
        }
    }
}
