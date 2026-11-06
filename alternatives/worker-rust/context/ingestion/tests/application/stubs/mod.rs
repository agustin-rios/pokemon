//! Puertos falsos y armado del procesador de corridas (sin base de datos).
#![allow(dead_code, clippy::unwrap_used)]

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use async_trait::async_trait;
use pokemon_context_ingestion::application::ports::{
    ClaimedRun, CommitOutcome, DatasetLoader, EtlRunQueue, FailureOutcome, Fence, PokemonSource,
    StagingStore, ViewsBuilder,
};
use pokemon_context_ingestion::application::use_cases::{
    BuildViews, GenerateData, LoadDataset, Pipeline, ProcessRun, ProcessRunConfig, ScrapeCatalog,
    ValidateDataset,
};
use pokemon_context_ingestion::application::{EnqueueError, RetryError};
use pokemon_context_ingestion::domain::{
    BattleRecord, CaptureRecord, EtlRun, EtlStep, PokemonRecord, PokemonTypeRecord, RunState,
    StagingDataset, StepName, StepState, StorageError, TrainerRecord, TypeRecord, ValidationReport,
};
use pokemon_data::dataset::{Dataset, PokemonRow, PokemonTypeRow, TypeRow};
use pokemon_data::generator::Generated;
use pokemon_data::pokeapi::{AttemptFailure, PokeApiError};
use serde_json::Value;
use uuid::Uuid;

use crate::support;
pub const LEASE: Duration = Duration::from_secs(30);
pub const STEP_DEADLINE: Duration = Duration::from_secs(300);

// --- Cola falsa -----------------------------------------------------------------

pub struct QueueState {
    pub run: EtlRun,
    pub claimable: bool,
    pub attempts: i32,
    pub max_attempts: i32,
    /// Después de cuántas llamadas a `start_step` el lease "se pierde".
    pub lose_lease_at_start: Option<usize>,
    pub heartbeat: Heartbeat,
    pub events: Vec<String>,
    pub outputs: HashMap<StepName, Option<Value>>,
    pub claim_args: Option<(String, f64)>,
    pub failure: Option<(StepName, String, bool)>,
    pub heartbeats: usize,
}

#[derive(Clone, Copy)]
pub enum Heartbeat {
    Alive,
    Lost,
    Failing,
    /// La base no responde: la llamada no vuelve.
    Hanging,
}

pub struct StubQueue(pub Mutex<QueueState>);

impl StubQueue {
    pub fn new(succeeded: &[StepName]) -> Arc<Self> {
        let steps = StepName::ALL
            .iter()
            .map(|name| EtlStep {
                name: *name,
                state: if succeeded.contains(name) {
                    StepState::Succeeded
                } else {
                    StepState::Pending
                },
                attempts: 0,
                started_at: None,
                finished_at: None,
                error: None,
                output: None,
            })
            .collect();
        Arc::new(Self(Mutex::new(QueueState {
            run: EtlRun {
                run_id: Uuid::from_u128(1),
                state: RunState::Queued,
                queued_at: "2026-11-05T00:00:00.000Z".into(),
                started_at: None,
                finished_at: None,
                attempts: 0,
                error: None,
                steps,
            },
            claimable: true,
            attempts: 0,
            max_attempts: 3,
            lose_lease_at_start: None,
            heartbeat: Heartbeat::Alive,
            events: Vec::new(),
            outputs: HashMap::new(),
            claim_args: None,
            failure: None,
            heartbeats: 0,
        })))
    }

    pub fn state(&self) -> std::sync::MutexGuard<'_, QueueState> {
        self.0.lock().unwrap()
    }

    pub fn events(&self) -> Vec<String> {
        self.state().events.clone()
    }

    pub fn with(self: Arc<Self>, f: impl FnOnce(&mut QueueState)) -> Arc<Self> {
        f(&mut self.state());
        self
    }
}

#[async_trait]
impl EtlRunQueue for StubQueue {
    async fn enqueue(&self) -> Result<EtlRun, EnqueueError> {
        unreachable!("el procesador no encola")
    }

    async fn get(&self, _: Uuid) -> Result<Option<EtlRun>, StorageError> {
        Ok(Some(self.state().run.clone()))
    }

    async fn retry(&self, _: Uuid) -> Result<EtlRun, RetryError> {
        unreachable!("el procesador no reintenta")
    }

    async fn claim(&self, worker_id: &str, lease: f64) -> Result<Option<ClaimedRun>, StorageError> {
        let mut s = self.state();
        s.claim_args = Some((worker_id.to_owned(), lease));
        if !s.claimable {
            return Ok(None);
        }
        s.attempts += 1;
        Ok(Some(ClaimedRun {
            fence: Fence {
                run_id: s.run.run_id,
                worker_id: worker_id.to_owned(),
                attempts: s.attempts,
            },
            max_attempts: s.max_attempts,
        }))
    }

    async fn heartbeat(&self, _: &Fence, _: f64) -> Result<bool, StorageError> {
        let mode = {
            let mut s = self.state();
            s.heartbeats += 1;
            s.heartbeat
        };
        match mode {
            Heartbeat::Alive => Ok(true),
            Heartbeat::Lost => Ok(false),
            Heartbeat::Hanging => std::future::pending().await,
            Heartbeat::Failing => Err(StorageError {
                sqlstate: None,
                source: "conexión rechazada".into(),
            }),
        }
    }

    async fn start_step(&self, _: &Fence, step: StepName) -> Result<bool, StorageError> {
        let mut s = self.state();
        let started = s.events.iter().filter(|e| e.starts_with("start:")).count();
        if s.lose_lease_at_start == Some(started) {
            return Ok(false);
        }
        s.events.push(format!("start:{step}"));
        Ok(true)
    }

    async fn finish_step(
        &self,
        _: &Fence,
        step: StepName,
        output: Option<&Value>,
    ) -> Result<bool, StorageError> {
        let mut s = self.state();
        s.events.push(format!("finish:{step}"));
        s.outputs.insert(step, output.cloned());
        Ok(true)
    }

    async fn complete_run(&self, _: &Fence) -> Result<bool, StorageError> {
        self.state().events.push("complete".into());
        Ok(true)
    }

    async fn release(&self, _: &Fence) -> Result<bool, StorageError> {
        self.state().events.push("release".into());
        Ok(true)
    }

    async fn fail_step(
        &self,
        fence: &Fence,
        step: StepName,
        message: &str,
        retryable: bool,
    ) -> Result<FailureOutcome, StorageError> {
        let mut s = self.state();
        s.events.push(format!("fail:{step}"));
        s.failure = Some((step, message.to_owned(), retryable));
        Ok(if retryable && fence.attempts < s.max_attempts {
            FailureOutcome::Requeued
        } else {
            FailureOutcome::Failed
        })
    }
}

// --- Otros puertos falsos ------------------------------------------------------------

/// `staging` en memoria con la misma semántica que el adaptador de Postgres.
pub struct StubStaging {
    pub data: Mutex<StagingDataset>,
    pub outcome: CommitOutcome,
    /// Escrituras hechas, en orden: `catalog` y `generated`.
    pub writes: Mutex<Vec<&'static str>>,
}

impl StubStaging {
    pub fn new(data: StagingDataset, outcome: CommitOutcome) -> Arc<Self> {
        Arc::new(Self {
            data: Mutex::new(data),
            outcome,
            writes: Mutex::new(Vec::new()),
        })
    }

    pub fn empty() -> Arc<Self> {
        Self::new(StagingDataset::default(), CommitOutcome::Committed)
    }

    /// `staging` con las 6 tablas del dataset de referencia.
    pub fn reference() -> Arc<Self> {
        Self::new(support::reference_dataset(), CommitOutcome::Committed)
    }

    pub fn edit(&self, change: impl FnOnce(&mut StagingDataset)) {
        change(&mut self.data.lock().unwrap());
    }

    pub fn writes(&self) -> Vec<&'static str> {
        self.writes.lock().unwrap().clone()
    }
}

#[async_trait]
impl StagingStore for StubStaging {
    async fn replace_catalog(
        &self,
        catalog: &Dataset,
        _: Option<&Fence>,
    ) -> Result<CommitOutcome, StorageError> {
        if self.outcome == CommitOutcome::LeaseLost {
            return Ok(self.outcome);
        }
        self.writes.lock().unwrap().push("catalog");
        let mut data = self.data.lock().unwrap();
        data.types = catalog
            .types
            .iter()
            .map(|r| TypeRecord {
                id: Some(r.id),
                name: Some(r.name.clone()),
            })
            .collect();
        data.pokemon = catalog
            .pokemon
            .iter()
            .map(|r| PokemonRecord {
                id: Some(r.id),
                name: Some(r.name.clone()),
                height: Some(r.height),
                weight: Some(r.weight),
                base_experience: r.base_experience,
                sprite_url: r.sprite.clone(),
            })
            .collect();
        data.pokemon_types = catalog
            .pokemon_types
            .iter()
            .map(|r| PokemonTypeRecord {
                pokemon_id: Some(r.pokemon_id),
                type_id: Some(r.type_id),
                slot: Some(r.slot),
            })
            .collect();
        Ok(CommitOutcome::Committed)
    }

    async fn replace_generated(
        &self,
        generated: &Generated,
        _: Option<&Fence>,
    ) -> Result<CommitOutcome, StorageError> {
        if self.outcome == CommitOutcome::LeaseLost {
            return Ok(self.outcome);
        }
        self.writes.lock().unwrap().push("generated");
        let mut data = self.data.lock().unwrap();
        data.trainers = generated
            .trainers
            .iter()
            .map(|r| TrainerRecord {
                id: Some(r.id),
                name: Some(r.name.clone()),
                region: Some(r.region.to_owned()),
                created_at: Some(r.created_at),
            })
            .collect();
        data.captures = generated
            .captures
            .iter()
            .map(|r| CaptureRecord {
                id: Some(r.id),
                trainer_id: Some(r.trainer_id),
                pokemon_id: Some(r.pokemon_id),
                captured_at: Some(r.captured_at),
                level: Some(r.level),
                location: Some(r.location.to_owned()),
            })
            .collect();
        data.battles = generated
            .battles
            .iter()
            .map(|r| BattleRecord {
                id: Some(r.id),
                pokemon_a_id: Some(r.pokemon_a_id),
                pokemon_b_id: Some(r.pokemon_b_id),
                winner_id: Some(r.winner_id),
                fought_at: Some(r.fought_at),
                duration_seconds: Some(r.duration_seconds),
            })
            .collect();
        Ok(CommitOutcome::Committed)
    }

    async fn pokemon_ids(&self) -> Result<Vec<i32>, StorageError> {
        let ids: std::collections::BTreeSet<i32> = self
            .data
            .lock()
            .unwrap()
            .pokemon
            .iter()
            .filter_map(|p| p.id)
            .collect();
        Ok(ids.into_iter().collect())
    }

    async fn read_all(&self) -> Result<StagingDataset, StorageError> {
        Ok(self.data.lock().unwrap().clone())
    }
}

pub enum SourceBehavior {
    Ok,
    Fail(fn() -> PokeApiError),
    Hang,
}

pub struct StubSource {
    pub behavior: SourceBehavior,
    pub calls: Mutex<Vec<u32>>,
}

impl StubSource {
    pub fn new(behavior: SourceBehavior) -> Arc<Self> {
        Arc::new(Self {
            behavior,
            calls: Mutex::new(Vec::new()),
        })
    }
}

pub fn small_catalog() -> Dataset {
    Dataset {
        pokemon: vec![
            PokemonRow {
                id: 1,
                name: "bulbasaur".into(),
                height: 7,
                weight: 69,
                base_experience: Some(64),
                sprite: None,
            },
            PokemonRow {
                id: 2,
                name: "ivysaur".into(),
                height: 10,
                weight: 130,
                base_experience: None,
                sprite: Some("https://img/2.png".into()),
            },
        ],
        types: vec![TypeRow {
            id: 1,
            name: "grass".into(),
        }],
        pokemon_types: vec![
            PokemonTypeRow {
                pokemon_id: 1,
                type_id: 1,
                slot: 1,
            },
            PokemonTypeRow {
                pokemon_id: 2,
                type_id: 1,
                slot: 1,
            },
        ],
    }
}

#[async_trait]
impl PokemonSource for StubSource {
    async fn scrape(&self, limit: u32) -> Result<Dataset, PokeApiError> {
        self.calls.lock().unwrap().push(limit);
        match &self.behavior {
            SourceBehavior::Ok => Ok(small_catalog()),
            SourceBehavior::Fail(make) => Err(make()),
            SourceBehavior::Hang => {
                tokio::time::sleep(Duration::from_secs(100_000)).await;
                Ok(small_catalog())
            }
        }
    }
}

pub struct StubLoader {
    pub outcome: CommitOutcome,
    pub loaded: Mutex<Vec<(usize, usize, Option<Fence>)>>,
}

impl StubLoader {
    pub fn new(outcome: CommitOutcome) -> Arc<Self> {
        Arc::new(Self {
            outcome,
            loaded: Mutex::new(Vec::new()),
        })
    }
}

#[async_trait]
impl DatasetLoader for StubLoader {
    async fn load(
        &self,
        report: &ValidationReport,
        fence: Option<&Fence>,
    ) -> Result<CommitOutcome, StorageError> {
        self.loaded.lock().unwrap().push((
            report.counts["pokemon"],
            report.counts["captures"],
            fence.cloned(),
        ));
        Ok(self.outcome)
    }
}

pub struct StubViews(pub Option<&'static str>);

#[async_trait]
impl ViewsBuilder for StubViews {
    async fn build(&self) -> Result<(), StorageError> {
        match self.0 {
            None => Ok(()),
            Some(code) => Err(StorageError {
                sqlstate: Some(code.to_owned()),
                source: "relación inexistente".into(),
            }),
        }
    }
}

// --- Armado --------------------------------------------------------------------------

pub struct Harness {
    pub queue: Arc<StubQueue>,
    pub staging: Arc<StubStaging>,
    pub source: Arc<StubSource>,
    pub loader: Arc<StubLoader>,
    pub processor: ProcessRun,
}

pub fn harness(
    queue: Arc<StubQueue>,
    staging: Arc<StubStaging>,
    source: Arc<StubSource>,
    loader: Arc<StubLoader>,
    views: StubViews,
) -> Harness {
    let pipeline = Pipeline::new(
        ScrapeCatalog::new(source.clone(), staging.clone(), 100),
        GenerateData::new(staging.clone()),
        ValidateDataset::new(staging.clone()),
        LoadDataset::new(staging.clone(), loader.clone()),
        BuildViews::new(Arc::new(views)),
    );
    let processor = ProcessRun::new(
        queue.clone(),
        pipeline,
        ProcessRunConfig {
            worker_id: "worker-test".into(),
            lease: LEASE,
            step_deadline: STEP_DEADLINE,
        },
    );
    Harness {
        queue,
        staging,
        source,
        loader,
        processor,
    }
}

pub fn default_harness(queue: Arc<StubQueue>) -> Harness {
    harness(
        queue,
        StubStaging::empty(),
        StubSource::new(SourceBehavior::Ok),
        StubLoader::new(CommitOutcome::Committed),
        StubViews(None),
    )
}

/// Las 6 tablas de referencia ya en `staging` (para pasos que parten de ellas).
pub fn with_reference_staging(queue: Arc<StubQueue>, source: Arc<StubSource>) -> Harness {
    harness(
        queue,
        StubStaging::reference(),
        source,
        StubLoader::new(CommitOutcome::Committed),
        StubViews(None),
    )
}

pub fn exhausted() -> PokeApiError {
    PokeApiError::Exhausted {
        url: "https://pokeapi.co/api/v2/pokemon/7".into(),
        attempts: 4,
        last: AttemptFailure::Status(503),
    }
}
