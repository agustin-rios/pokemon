//! Bucle del worker con un procesador y un notificador falsos y reloj pausado.

use std::collections::VecDeque;
use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use async_trait::async_trait;
use pokemon_context_ingestion::application::ports::RunNotifier;
use pokemon_context_ingestion::application::use_cases::ProcessOutcome;
use pokemon_context_ingestion::domain::StorageError;
use pokemon_worker::modules::etl::etl_processor::{ProcessNext, RunnerConfig, run};
use tokio::time::{Instant, sleep};
use uuid::Uuid;

const POLL: Duration = Duration::from_secs(5);
const GRACE: Duration = Duration::from_secs(10);
const CONFIG: RunnerConfig = RunnerConfig {
    poll: POLL,
    shutdown_grace: GRACE,
};

/// Qué hace la próxima llamada a `process_next`; sin guion devuelve `Idle`.
enum Step {
    Outcome(ProcessOutcome),
    Error,
    /// Tarda `Duration` en terminar la corrida.
    Slow(Duration, ProcessOutcome),
}

#[derive(Default)]
struct StubProcessor {
    script: Mutex<VecDeque<Step>>,
    started: AtomicUsize,
    completed: AtomicUsize,
    stop_requests: AtomicUsize,
    releases: AtomicUsize,
}

impl StubProcessor {
    fn with(steps: Vec<Step>) -> Self {
        Self {
            script: Mutex::new(steps.into()),
            ..Self::default()
        }
    }
}

#[async_trait]
impl ProcessNext for StubProcessor {
    async fn process_next(&self) -> Result<ProcessOutcome, StorageError> {
        self.started.fetch_add(1, Ordering::SeqCst);
        let step = self.script.lock().unwrap().pop_front();
        let result = match step {
            None => Ok(ProcessOutcome::Idle),
            Some(Step::Outcome(outcome)) => Ok(outcome),
            Some(Step::Error) => Err(StorageError {
                sqlstate: None,
                source: "sin conexión".into(),
            }),
            Some(Step::Slow(duration, outcome)) => {
                sleep(duration).await;
                Ok(outcome)
            }
        };
        self.completed.fetch_add(1, Ordering::SeqCst);
        result
    }

    fn request_stop(&self) {
        self.stop_requests.fetch_add(1, Ordering::SeqCst);
    }

    async fn release_abandoned(&self) -> Result<(), StorageError> {
        self.releases.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
}

/// Espera el plazo completo (como un `LISTEN` sin avisos) o despierta al instante.
struct StubNotifier {
    wake_immediately: bool,
    waits: Mutex<Vec<Duration>>,
}

impl StubNotifier {
    fn new(wake_immediately: bool) -> Self {
        Self {
            wake_immediately,
            waits: Mutex::new(Vec::new()),
        }
    }

    fn waits(&self) -> Vec<Duration> {
        self.waits.lock().unwrap().clone()
    }
}

#[async_trait]
impl RunNotifier for StubNotifier {
    async fn wait(&self, timeout: Duration) -> Option<Uuid> {
        self.waits.lock().unwrap().push(timeout);
        if self.wake_immediately {
            // Cede el turno para que el reloj pausado y el apagado avancen.
            sleep(Duration::from_millis(1)).await;
            Some(Uuid::nil())
        } else {
            sleep(timeout).await;
            None
        }
    }
}

fn shutdown_after(seconds: u64) -> impl std::future::Future<Output = ()> {
    sleep(Duration::from_secs(seconds))
}

#[tokio::test(start_paused = true)]
async fn tras_una_corrida_toma_la_siguiente_sin_esperar() {
    let id = Uuid::nil();
    let processor = StubProcessor::with(vec![
        Step::Outcome(ProcessOutcome::Succeeded(id)),
        Step::Outcome(ProcessOutcome::Failed(id)),
        Step::Outcome(ProcessOutcome::Requeued(id)),
    ]);
    let notifier = StubNotifier::new(false);

    run(&processor, &notifier, CONFIG, shutdown_after(1)).await;

    // Tres corridas seguidas y recién al quedar vacío espera (una vez, hasta el apagado).
    assert_eq!(processor.started.load(Ordering::SeqCst), 4);
    assert_eq!(notifier.waits(), [POLL]);
}

#[tokio::test(start_paused = true)]
async fn sin_corridas_espera_el_aviso_o_el_sondeo() {
    let processor = StubProcessor::default();
    let notifier = StubNotifier::new(false);
    let start = Instant::now();

    run(&processor, &notifier, CONFIG, shutdown_after(12)).await;

    // Intenta en t=0, 5 y 10; el apagado llega en t=12 durante la espera.
    assert_eq!(processor.started.load(Ordering::SeqCst), 3);
    assert_eq!(notifier.waits(), [POLL, POLL, POLL]);
    assert_eq!(start.elapsed(), Duration::from_secs(12));
}

#[tokio::test(start_paused = true)]
async fn un_aviso_sin_corrida_vuelve_a_esperar() {
    let processor = StubProcessor::default();
    let notifier = StubNotifier::new(true);

    run(
        &processor,
        &notifier,
        CONFIG,
        sleep(Duration::from_millis(10)),
    )
    .await;

    // Cada intento vacío va seguido de una espera: no hay busy loop.
    let tries = processor.started.load(Ordering::SeqCst);
    assert!(tries >= 2, "{tries}");
    assert!(notifier.waits().len() >= tries - 1);
}

#[tokio::test(start_paused = true)]
async fn un_error_de_la_cola_no_tumba_al_worker_y_espera() {
    let processor = StubProcessor::with(vec![Step::Error]);
    let notifier = StubNotifier::new(false);

    run(&processor, &notifier, CONFIG, shutdown_after(7)).await;

    // Error en t=0, espera 5 s, reintenta en t=5 (vacío) y vuelve a esperar.
    assert_eq!(processor.started.load(Ordering::SeqCst), 2);
    assert_eq!(notifier.waits().len(), 2);
}

#[tokio::test(start_paused = true)]
async fn al_apagar_deja_terminar_la_corrida_si_cabe_en_el_plazo() {
    let processor = StubProcessor::with(vec![Step::Slow(
        Duration::from_secs(5),
        ProcessOutcome::Succeeded(Uuid::nil()),
    )]);
    let notifier = StubNotifier::new(false);
    let start = Instant::now();

    run(&processor, &notifier, CONFIG, shutdown_after(3)).await;

    assert_eq!(processor.completed.load(Ordering::SeqCst), 1);
    // Se le pidió detenerse al paso en curso, pero no hubo que abandonar nada.
    assert_eq!(processor.stop_requests.load(Ordering::SeqCst), 1);
    assert_eq!(processor.releases.load(Ordering::SeqCst), 0);
    assert_eq!(start.elapsed(), Duration::from_secs(5));
    // Apagado: no toma otra corrida ni vuelve a esperar.
    assert_eq!(processor.started.load(Ordering::SeqCst), 1);
    assert!(notifier.waits().is_empty());
}

#[tokio::test(start_paused = true)]
async fn al_apagar_abandona_la_corrida_pasado_el_plazo() {
    let processor = StubProcessor::with(vec![Step::Slow(
        Duration::from_secs(1000),
        ProcessOutcome::Succeeded(Uuid::nil()),
    )]);
    let notifier = StubNotifier::new(false);
    let start = Instant::now();

    run(&processor, &notifier, CONFIG, shutdown_after(3)).await;

    assert_eq!(processor.completed.load(Ordering::SeqCst), 0);
    // Abandonada, la corrida se devuelve a la cola para que el relevo no espere el lease.
    assert_eq!(processor.stop_requests.load(Ordering::SeqCst), 1);
    assert_eq!(processor.releases.load(Ordering::SeqCst), 1);
    assert_eq!(start.elapsed(), Duration::from_secs(13));
    assert!(notifier.waits().is_empty());
}
