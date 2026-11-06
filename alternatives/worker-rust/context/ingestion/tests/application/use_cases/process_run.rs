//! Procesador de corridas con puertos falsos: camino feliz, retoma, fallos
//! reintentables y permanentes, lease perdido, plazo de los pasos y apagado.

use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use pokemon_context_ingestion::application::ports::{CommitOutcome, PokemonSource};
use pokemon_context_ingestion::application::use_cases::{
    BuildViews, GenerateData, LoadDataset, Pipeline, ProcessOutcome, ProcessRun, ProcessRunConfig,
    ScrapeCatalog, ValidateDataset,
};
use pokemon_context_ingestion::domain::{StagingDataset, StepName, StepState};
use pokemon_data::dataset::Dataset;
use pokemon_data::pokeapi::PokeApiError;
use serde_json::json;
use uuid::Uuid;

use crate::stubs::*;
use crate::support;

#[tokio::test]
async fn idle_when_there_is_nothing_to_claim() {
    let queue = StubQueue::new(&[]).with(|s| s.claimable = false);
    let h = default_harness(queue);

    assert_eq!(
        h.processor.process_next().await.unwrap(),
        ProcessOutcome::Idle
    );
    assert!(h.queue.events().is_empty());
    // El claim usa el id del worker y el lease en segundos.
    assert_eq!(
        h.queue.state().claim_args,
        Some(("worker-test".to_owned(), 30.0))
    );
}

#[tokio::test]
async fn happy_path_runs_the_five_steps_in_order() {
    let h = default_harness(StubQueue::new(&[]));

    let outcome = h.processor.process_next().await.unwrap();

    assert_eq!(outcome, ProcessOutcome::Succeeded(Uuid::from_u128(1)));
    assert_eq!(
        h.queue.events(),
        [
            "start:scrape",
            "finish:scrape",
            "start:generate",
            "finish:generate",
            "start:validate",
            "finish:validate",
            "start:load",
            "finish:load",
            "start:build_views",
            "finish:build_views",
            "complete",
        ]
    );
    assert_eq!(*h.source.calls.lock().unwrap(), [100]);

    let state = h.queue.state();
    assert_eq!(
        state.outputs[&StepName::Scrape],
        Some(json!({"pokemon": 2, "types": 1, "pokemonTypes": 2}))
    );
    assert_eq!(
        state.outputs[&StepName::Generate],
        Some(json!({"trainers": 50, "captures": 5000, "battles": 2000}))
    );
    let validate = state.outputs[&StepName::Validate].clone().unwrap();
    assert_eq!(validate["counts"]["pokemon"], 2);
    assert_eq!(validate["counts"]["trainers"], 50);
    assert_eq!(validate["counts"]["captures"], 5000);
    // Las batallas con duración negativa se descartan, y se informan por tabla.
    let discarded = validate["discarded"]["battles"].as_array().unwrap().len() as u64;
    assert!(discarded > 0);
    assert_eq!(
        validate["counts"]["battles"].as_u64().unwrap() + discarded,
        2000
    );
    assert!(validate["discarded"].get("captures").is_none());
    assert_eq!(
        state.outputs[&StepName::Load],
        Some(json!({"counts": validate["counts"]}))
    );
    assert_eq!(state.outputs[&StepName::BuildViews], None);
    drop(state);

    // El loader recibe lo validado y el fence de esta ejecución.
    let loaded = h.loader.loaded.lock().unwrap();
    assert_eq!(loaded.len(), 1);
    assert_eq!((loaded[0].0, loaded[0].1), (2, 5000));
    let fence = loaded[0].2.clone().unwrap();
    assert_eq!(
        (fence.worker_id.as_str(), fence.attempts),
        ("worker-test", 1)
    );
}

#[tokio::test]
async fn resume_skips_succeeded_steps() {
    let queue = StubQueue::new(&[StepName::Scrape, StepName::Generate]);
    let h = with_reference_staging(queue, StubSource::new(SourceBehavior::Ok));

    let outcome = h.processor.process_next().await.unwrap();

    assert_eq!(outcome, ProcessOutcome::Succeeded(Uuid::from_u128(1)));
    assert_eq!(
        h.queue.events(),
        [
            "start:validate",
            "finish:validate",
            "start:load",
            "finish:load",
            "start:build_views",
            "finish:build_views",
            "complete",
        ]
    );
    assert!(h.source.calls.lock().unwrap().is_empty());
    assert!(h.staging.writes().is_empty());
    let validate = h.queue.state().outputs[&StepName::Validate]
        .clone()
        .unwrap();
    assert_eq!(validate["counts"]["battles"], 1996);
    assert_eq!(
        validate["discarded"]["battles"].as_array().unwrap().len(),
        4
    );
}

#[tokio::test]
async fn resume_from_a_failed_step_reruns_it_and_the_rest() {
    let queue = StubQueue::new(&[StepName::Scrape, StepName::Generate]).with(|s| {
        s.run.steps[2].state = StepState::Failed;
        s.run.steps[3].state = StepState::Running; // dejado por un worker muerto
    });
    let h = with_reference_staging(queue, StubSource::new(SourceBehavior::Ok));

    h.processor.process_next().await.unwrap();

    assert_eq!(h.queue.events().first().unwrap(), "start:validate");
    assert!(h.queue.events().contains(&"start:load".to_owned()));
}

#[tokio::test]
async fn retryable_failure_requeues_and_stops() {
    let h = harness(
        StubQueue::new(&[]),
        StubStaging::empty(),
        StubSource::new(SourceBehavior::Fail(exhausted)),
        StubLoader::new(CommitOutcome::Committed),
        StubViews(None),
    );

    let outcome = h.processor.process_next().await.unwrap();

    assert_eq!(outcome, ProcessOutcome::Requeued(Uuid::from_u128(1)));
    assert_eq!(h.queue.events(), ["start:scrape", "fail:scrape"]);
    let (step, message, retryable) = h.queue.state().failure.clone().unwrap();
    assert_eq!(step, StepName::Scrape);
    assert!(retryable);
    assert_eq!(
        message,
        "GET https://pokeapi.co/api/v2/pokemon/7 falló tras 4 intentos"
    );
}

#[tokio::test]
async fn retryable_failure_without_attempts_left_fails_the_run() {
    let queue = StubQueue::new(&[]).with(|s| s.attempts = 2); // este claim es el intento 3 de 3
    let h = harness(
        queue,
        StubStaging::empty(),
        StubSource::new(SourceBehavior::Fail(exhausted)),
        StubLoader::new(CommitOutcome::Committed),
        StubViews(None),
    );

    assert_eq!(
        h.processor.process_next().await.unwrap(),
        ProcessOutcome::Failed(Uuid::from_u128(1))
    );
}

#[tokio::test]
async fn permanent_failure_fails_the_run_without_retrying() {
    let queue = StubQueue::new(&[StepName::Scrape, StepName::Generate]);
    let h = with_reference_staging(queue, StubSource::new(SourceBehavior::Ok));
    h.staging.edit(|d| d.captures[0].location = None);

    let outcome = h.processor.process_next().await.unwrap();

    assert_eq!(outcome, ProcessOutcome::Failed(Uuid::from_u128(1)));
    assert_eq!(h.queue.events(), ["start:validate", "fail:validate"]);
    let (step, message, retryable) = h.queue.state().failure.clone().unwrap();
    assert_eq!(step, StepName::Validate);
    assert!(!retryable);
    assert_eq!(
        message,
        "1 problema(s) en los datos:\n- captures id 1: location vacío"
    );
    assert!(h.loader.loaded.lock().unwrap().is_empty());
}

#[tokio::test]
async fn http_client_errors_are_permanent() {
    let h = harness(
        StubQueue::new(&[]),
        StubStaging::empty(),
        StubSource::new(SourceBehavior::Fail(|| PokeApiError::Status {
            url: "https://pokeapi.co/api/v2/pokemon/1".into(),
            status: 404,
        })),
        StubLoader::new(CommitOutcome::Committed),
        StubViews(None),
    );

    assert_eq!(
        h.processor.process_next().await.unwrap(),
        ProcessOutcome::Failed(Uuid::from_u128(1))
    );
    assert!(!h.queue.state().failure.clone().unwrap().2);
}

#[tokio::test]
async fn missing_views_relation_is_permanent_in_build_views() {
    let queue = StubQueue::new(&[StepName::Scrape, StepName::Generate]);
    let h = harness(
        queue,
        StubStaging::reference(),
        StubSource::new(SourceBehavior::Ok),
        StubLoader::new(CommitOutcome::Committed),
        StubViews(Some("42P01")),
    );

    assert_eq!(
        h.processor.process_next().await.unwrap(),
        ProcessOutcome::Failed(Uuid::from_u128(1))
    );
    let (step, message, retryable) = h.queue.state().failure.clone().unwrap();
    assert_eq!(step, StepName::BuildViews);
    assert!(!retryable);
    assert_eq!(message, "error de base de datos: relación inexistente");
}

#[tokio::test]
async fn database_errors_without_sqlstate_are_retryable() {
    let queue = StubQueue::new(&[StepName::Scrape, StepName::Generate]);
    let h = harness(
        queue,
        StubStaging::reference(),
        StubSource::new(SourceBehavior::Ok),
        StubLoader::new(CommitOutcome::Committed),
        StubViews(Some("57P01")),
    );

    assert_eq!(
        h.processor.process_next().await.unwrap(),
        ProcessOutcome::Requeued(Uuid::from_u128(1))
    );
}

#[tokio::test]
async fn lease_lost_when_a_step_cannot_start_writes_nothing_more() {
    let queue = StubQueue::new(&[]).with(|s| s.lose_lease_at_start = Some(2));
    let h = default_harness(queue);

    let outcome = h.processor.process_next().await.unwrap();

    assert_eq!(outcome, ProcessOutcome::LeaseLost(Uuid::from_u128(1)));
    assert_eq!(
        h.queue.events(),
        [
            "start:scrape",
            "finish:scrape",
            "start:generate",
            "finish:generate"
        ]
    );
}

#[tokio::test]
async fn lease_lost_in_the_loader_does_not_finish_the_step() {
    let queue = StubQueue::new(&[StepName::Scrape, StepName::Generate]);
    let h = harness(
        queue,
        StubStaging::reference(),
        StubSource::new(SourceBehavior::Ok),
        StubLoader::new(CommitOutcome::LeaseLost),
        StubViews(None),
    );

    let outcome = h.processor.process_next().await.unwrap();

    assert_eq!(outcome, ProcessOutcome::LeaseLost(Uuid::from_u128(1)));
    assert_eq!(
        h.queue.events(),
        ["start:validate", "finish:validate", "start:load"]
    );
}

#[tokio::test(start_paused = true)]
async fn heartbeat_losing_the_lease_cancels_the_running_step() {
    let queue = StubQueue::new(&[]).with(|s| s.heartbeat = Heartbeat::Lost);
    let h = harness(
        queue,
        StubStaging::empty(),
        StubSource::new(SourceBehavior::Hang),
        StubLoader::new(CommitOutcome::Committed),
        StubViews(None),
    );

    let outcome = h.processor.process_next().await.unwrap();

    assert_eq!(outcome, ProcessOutcome::LeaseLost(Uuid::from_u128(1)));
    // El paso se cancelaba antes de terminar: no hay `finish` ni `fail`.
    assert_eq!(h.queue.events(), ["start:scrape"]);
    assert_eq!(h.queue.state().heartbeats, 1);
}

#[tokio::test(start_paused = true)]
async fn heartbeat_errors_are_tolerated_until_the_local_deadline() {
    let queue = StubQueue::new(&[]).with(|s| s.heartbeat = Heartbeat::Failing);
    let h = harness(
        queue,
        StubStaging::empty(),
        StubSource::new(SourceBehavior::Hang),
        StubLoader::new(CommitOutcome::Committed),
        StubViews(None),
    );

    let outcome = h.processor.process_next().await.unwrap();

    assert_eq!(outcome, ProcessOutcome::LeaseLost(Uuid::from_u128(1)));
    // Ticks a los 10 s y 20 s fallan sin perder el lease; el de los 30 s lo da por perdido.
    assert_eq!(h.queue.state().heartbeats, 3);
}

#[tokio::test(start_paused = true)]
async fn a_heartbeat_that_never_answers_loses_the_lease_at_the_local_deadline() {
    let queue = StubQueue::new(&[]).with(|s| s.heartbeat = Heartbeat::Hanging);
    let h = harness(
        queue,
        StubStaging::empty(),
        StubSource::new(SourceBehavior::Hang),
        StubLoader::new(CommitOutcome::Committed),
        StubViews(None),
    );
    let started = tokio::time::Instant::now();

    let outcome = h.processor.process_next().await.unwrap();

    assert_eq!(outcome, ProcessOutcome::LeaseLost(Uuid::from_u128(1)));
    // Se corta en el plazo local (30 s), no cuando la base por fin responda.
    assert_eq!(started.elapsed(), LEASE);
    assert_eq!(h.queue.state().heartbeats, 1);
}

/// Fuente que avisa que empezó y tarda un poco en terminar el scrape.
struct SignalingSource(Arc<tokio::sync::Notify>);

#[async_trait]
impl PokemonSource for SignalingSource {
    async fn scrape(&self, _: u32) -> Result<Dataset, PokeApiError> {
        self.0.notify_one();
        tokio::time::sleep(Duration::from_secs(1)).await;
        Ok(small_catalog())
    }
}

fn processor_with_source(
    queue: &Arc<StubQueue>,
    source: Arc<dyn PokemonSource>,
) -> Arc<ProcessRun> {
    let staging = StubStaging::empty();
    let pipeline = Pipeline::new(
        ScrapeCatalog::new(source, staging.clone(), 100),
        GenerateData::new(staging.clone()),
        ValidateDataset::new(staging.clone()),
        LoadDataset::new(staging, StubLoader::new(CommitOutcome::Committed)),
        BuildViews::new(Arc::new(StubViews(None))),
    );
    Arc::new(ProcessRun::new(
        queue.clone(),
        pipeline,
        ProcessRunConfig {
            worker_id: "w".into(),
            lease: LEASE,
            step_deadline: STEP_DEADLINE,
        },
    ))
}

#[tokio::test(start_paused = true)]
async fn a_stop_request_finishes_the_current_step_then_releases_the_run() {
    let queue = StubQueue::new(&[]);
    let started = Arc::new(tokio::sync::Notify::new());
    let processor = processor_with_source(&queue, Arc::new(SignalingSource(started.clone())));
    let task = {
        let processor = processor.clone();
        tokio::spawn(async move { processor.process_next().await })
    };

    started.notified().await;
    processor.request_stop();
    let outcome = task.await.unwrap().unwrap();

    assert_eq!(outcome, ProcessOutcome::Stopped(Uuid::from_u128(1)));
    // El paso en curso termina; no empieza `generate`; la corrida se devuelve a la cola.
    assert_eq!(queue.events(), ["start:scrape", "finish:scrape", "release"]);
    // Ya no se toman corridas.
    assert_eq!(
        processor.process_next().await.unwrap(),
        ProcessOutcome::Idle
    );
}

#[tokio::test(start_paused = true)]
async fn an_abandoned_run_is_released_without_waiting_for_the_lease() {
    let queue = StubQueue::new(&[]);
    let processor = processor_with_source(&queue, StubSource::new(SourceBehavior::Hang));

    // Plazo de apagado vencido: se suelta el futuro en mitad del paso.
    let abandoned = tokio::time::timeout(Duration::from_secs(5), processor.process_next()).await;
    assert!(abandoned.is_err());
    assert_eq!(queue.events(), ["start:scrape"]);

    let released = processor.release_abandoned().await.unwrap();

    assert_eq!(released, Some(Uuid::from_u128(1)));
    assert_eq!(queue.events(), ["start:scrape", "release"]);
    assert_eq!(processor.release_abandoned().await.unwrap(), None);
}

#[tokio::test(start_paused = true)]
async fn heartbeat_keeps_the_lease_alive_during_a_long_step() {
    struct SlowThenOk;
    #[async_trait]
    impl PokemonSource for SlowThenOk {
        async fn scrape(&self, _: u32) -> Result<Dataset, PokeApiError> {
            tokio::time::sleep(Duration::from_secs(100)).await;
            Ok(small_catalog())
        }
    }
    let queue = StubQueue::new(&[]);
    let staging = StubStaging::empty();
    let loader = StubLoader::new(CommitOutcome::Committed);
    let pipeline = Pipeline::new(
        ScrapeCatalog::new(Arc::new(SlowThenOk), staging.clone(), 100),
        GenerateData::new(staging.clone()),
        ValidateDataset::new(staging.clone()),
        LoadDataset::new(staging, loader),
        BuildViews::new(Arc::new(StubViews(None))),
    );
    let processor = ProcessRun::new(
        queue.clone(),
        pipeline,
        ProcessRunConfig {
            worker_id: "w".into(),
            lease: LEASE,
            step_deadline: STEP_DEADLINE,
        },
    );

    let outcome = processor.process_next().await.unwrap();

    assert_eq!(outcome, ProcessOutcome::Succeeded(Uuid::from_u128(1)));
    // Un latido cada 10 s durante los 100 s del paso.
    assert!(queue.state().heartbeats >= 9);
}

// --- Plazo de los pasos -------------------------------------------------------------

#[tokio::test(start_paused = true)]
async fn a_step_over_its_deadline_is_cancelled_and_retried_without_writing() {
    let queue = StubQueue::new(&[]);
    let staging = StubStaging::empty();
    let pipeline = Pipeline::new(
        ScrapeCatalog::new(StubSource::new(SourceBehavior::Hang), staging.clone(), 100),
        GenerateData::new(staging.clone()),
        ValidateDataset::new(staging.clone()),
        LoadDataset::new(staging.clone(), StubLoader::new(CommitOutcome::Committed)),
        BuildViews::new(Arc::new(StubViews(None))),
    );
    let processor = ProcessRun::new(
        queue.clone(),
        pipeline,
        ProcessRunConfig {
            worker_id: "w".into(),
            lease: LEASE,
            step_deadline: Duration::from_secs(5),
        },
    );

    let outcome = processor.process_next().await.unwrap();

    assert_eq!(outcome, ProcessOutcome::Requeued(Uuid::from_u128(1)));
    assert_eq!(queue.events(), ["start:scrape", "fail:scrape"]);
    let (step, message, retryable) = queue.state().failure.clone().unwrap();
    assert_eq!(step, StepName::Scrape);
    assert!(retryable);
    assert_eq!(message, "el paso superó el plazo de 5 s");
    assert!(staging.writes().is_empty());
}

#[tokio::test]
async fn lease_lost_in_scrape_or_generate_does_not_finish_the_step() {
    let queue = StubQueue::new(&[]);
    let h = harness(
        queue,
        StubStaging::new(StagingDataset::default(), CommitOutcome::LeaseLost),
        StubSource::new(SourceBehavior::Ok),
        StubLoader::new(CommitOutcome::Committed),
        StubViews(None),
    );
    assert_eq!(
        h.processor.process_next().await.unwrap(),
        ProcessOutcome::LeaseLost(Uuid::from_u128(1))
    );
    assert_eq!(h.queue.events(), ["start:scrape"]);

    let queue = StubQueue::new(&[StepName::Scrape]);
    let staging = StubStaging::new(support::reference_dataset(), CommitOutcome::LeaseLost);
    let h = harness(
        queue,
        staging,
        StubSource::new(SourceBehavior::Ok),
        StubLoader::new(CommitOutcome::Committed),
        StubViews(None),
    );
    assert_eq!(
        h.processor.process_next().await.unwrap(),
        ProcessOutcome::LeaseLost(Uuid::from_u128(1))
    );
    assert_eq!(h.queue.events(), ["start:generate"]);
}
