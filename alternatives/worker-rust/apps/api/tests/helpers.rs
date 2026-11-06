//! Repositorios y cola falsos para probar la API sin base de datos.
#![allow(dead_code, clippy::new_without_default, clippy::unwrap_used)]

use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use axum::Router;
use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode};
use pokemon_api::config::CorsOrigins;
use pokemon_api::modules::pokedex::PokedexRepositories;
use pokemon_api::{app_module, app_setup};
use pokemon_context_ingestion::application::ports::{
    ClaimedRun, EtlRunQueue, FailureOutcome, Fence,
};
use pokemon_context_ingestion::application::{EnqueueError, RetryError};
use pokemon_context_ingestion::domain::{
    EtlRun, EtlStep, RunState, StepName, StepState, StorageError,
};
use pokemon_context_pokedex::application::RepositoryError;
use pokemon_context_pokedex::application::ports::{
    Page, PageQuery, PokemonRepository, ReportsRepository,
};
use pokemon_context_pokedex::domain::{
    LevelClassification, MonthlyCaptureGrowth, Pokemon, PokemonType, TopTrainer, TypeSummary,
};
use serde_json::Value;
use tower::ServiceExt;
use uuid::Uuid;

/// Una respuesta pendiente: la consume la primera llamada.
pub struct Slot<T>(Mutex<Option<T>>);

impl<T> Slot<T> {
    pub fn empty() -> Self {
        Self(Mutex::new(None))
    }

    pub fn set(&self, value: T) {
        *self.0.lock().unwrap() = Some(value);
    }

    fn take(&self) -> T {
        self.0
            .lock()
            .unwrap()
            .take()
            .expect("el test no preparó esta respuesta")
    }
}

/// Registro de las llamadas que recibieron los casos de uso.
#[derive(Default)]
pub struct Calls(Mutex<Vec<String>>);

impl Calls {
    pub fn push(&self, call: impl Into<String>) {
        self.0.lock().unwrap().push(call.into());
    }

    pub fn all(&self) -> Vec<String> {
        self.0.lock().unwrap().clone()
    }
}

pub struct StubPokemon {
    pub calls: Arc<Calls>,
    pub list: Slot<Result<Page<Pokemon>, RepositoryError>>,
    pub find: Slot<Result<Option<Pokemon>, RepositoryError>>,
}

#[async_trait]
impl PokemonRepository for StubPokemon {
    async fn list(&self, query: PageQuery) -> Result<Page<Pokemon>, RepositoryError> {
        self.calls
            .push(format!("list {} {}", query.page, query.page_size));
        self.list.take()
    }

    async fn find_by_id(&self, id: i32) -> Result<Option<Pokemon>, RepositoryError> {
        self.calls.push(format!("find {id}"));
        self.find.take()
    }
}

pub struct StubReports {
    pub calls: Arc<Calls>,
    pub type_summary: Slot<Result<Vec<TypeSummary>, RepositoryError>>,
    pub monthly: Slot<Result<Vec<MonthlyCaptureGrowth>, RepositoryError>>,
    pub top: Slot<Result<Vec<TopTrainer>, RepositoryError>>,
    pub level: Slot<Result<Vec<LevelClassification>, RepositoryError>>,
}

#[async_trait]
impl ReportsRepository for StubReports {
    async fn type_summary(&self) -> Result<Vec<TypeSummary>, RepositoryError> {
        self.calls.push("type_summary");
        self.type_summary.take()
    }

    async fn monthly_capture_growth(&self) -> Result<Vec<MonthlyCaptureGrowth>, RepositoryError> {
        self.calls.push("monthly");
        self.monthly.take()
    }

    async fn top_trainers_by_region(&self) -> Result<Vec<TopTrainer>, RepositoryError> {
        self.calls.push("top");
        self.top.take()
    }

    async fn level_classification_by_type(
        &self,
    ) -> Result<Vec<LevelClassification>, RepositoryError> {
        self.calls.push("level");
        self.level.take()
    }
}

pub struct StubQueue {
    pub calls: Arc<Calls>,
    pub enqueue: Slot<Result<EtlRun, EnqueueError>>,
    pub get: Slot<Result<Option<EtlRun>, StorageError>>,
    pub retry: Slot<Result<EtlRun, RetryError>>,
}

#[async_trait]
impl EtlRunQueue for StubQueue {
    async fn enqueue(&self) -> Result<EtlRun, EnqueueError> {
        self.calls.push("enqueue");
        self.enqueue.take()
    }

    async fn get(&self, run_id: Uuid) -> Result<Option<EtlRun>, StorageError> {
        self.calls.push(format!("get {run_id}"));
        self.get.take()
    }

    async fn retry(&self, run_id: Uuid) -> Result<EtlRun, RetryError> {
        self.calls.push(format!("retry {run_id}"));
        self.retry.take()
    }

    async fn claim(&self, _: &str, _: f64) -> Result<Option<ClaimedRun>, StorageError> {
        unreachable!("la API no toma corridas")
    }

    async fn heartbeat(&self, _: &Fence, _: f64) -> Result<bool, StorageError> {
        unreachable!("la API no renueva leases")
    }

    async fn start_step(&self, _: &Fence, _: StepName) -> Result<bool, StorageError> {
        unreachable!("la API no ejecuta pasos")
    }

    async fn finish_step(
        &self,
        _: &Fence,
        _: StepName,
        _: Option<&Value>,
    ) -> Result<bool, StorageError> {
        unreachable!("la API no ejecuta pasos")
    }

    async fn complete_run(&self, _: &Fence) -> Result<bool, StorageError> {
        unreachable!("la API no ejecuta corridas")
    }

    async fn release(&self, _: &Fence) -> Result<bool, StorageError> {
        unreachable!("la API no ejecuta corridas")
    }

    async fn fail_step(
        &self,
        _: &Fence,
        _: StepName,
        _: &str,
        _: bool,
    ) -> Result<FailureOutcome, StorageError> {
        unreachable!("la API no ejecuta pasos")
    }
}

/// La API armada con stubs; cada test prepara las respuestas que necesita.
pub struct TestApi {
    pub pokemon: Arc<StubPokemon>,
    pub reports: Arc<StubReports>,
    pub queue: Arc<StubQueue>,
    pub calls: Arc<Calls>,
    pub router: Router,
}

impl TestApi {
    pub fn new() -> Self {
        Self::with_cors(&CorsOrigins::Any)
    }

    pub fn with_cors(cors: &CorsOrigins) -> Self {
        let calls = Arc::new(Calls::default());
        let pokemon = Arc::new(StubPokemon {
            calls: Arc::clone(&calls),
            list: Slot::empty(),
            find: Slot::empty(),
        });
        let reports = Arc::new(StubReports {
            calls: Arc::clone(&calls),
            type_summary: Slot::empty(),
            monthly: Slot::empty(),
            top: Slot::empty(),
            level: Slot::empty(),
        });
        let queue = Arc::new(StubQueue {
            calls: Arc::clone(&calls),
            enqueue: Slot::empty(),
            get: Slot::empty(),
            retry: Slot::empty(),
        });
        let pokedex = PokedexRepositories::new(pokemon.clone(), reports.clone());
        let router = app_setup(app_module(&pokedex, queue.clone()), cors);
        Self {
            pokemon,
            reports,
            queue,
            calls,
            router,
        }
    }

    /// Hace el request y devuelve el status y el cuerpo JSON (`Null` si no hay).
    pub async fn request(&self, method: &str, uri: &str) -> (StatusCode, Value) {
        let (status, _, body) = self.send(method, uri, &[]).await;
        (status, body)
    }

    pub async fn get(&self, uri: &str) -> (StatusCode, Value) {
        self.request("GET", uri).await
    }

    pub async fn send(
        &self,
        method: &str,
        uri: &str,
        headers: &[(&str, &str)],
    ) -> (StatusCode, axum::http::HeaderMap, Value) {
        let mut request = Request::builder().method(method).uri(uri);
        for (name, value) in headers {
            request = request.header(*name, *value);
        }
        let response = self
            .router
            .clone()
            .oneshot(request.body(Body::empty()).unwrap())
            .await
            .unwrap();
        let status = response.status();
        let headers = response.headers().clone();
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let body = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        (status, headers, body)
    }
}

pub fn charizard() -> Pokemon {
    Pokemon {
        id: 6,
        name: "charizard".into(),
        height: 17,
        weight: 905,
        base_experience: 267,
        sprite: Some("https://img/6.png".into()),
        types: vec![
            PokemonType {
                id: 10,
                name: "fire".into(),
                slot: 1,
            },
            PokemonType {
                id: 3,
                name: "flying".into(),
                slot: 2,
            },
        ],
    }
}

pub const RUN_ID: &str = "0b9a3f0e-4a64-4d3a-9d3e-5f2f4c1d7a10";

pub fn run(state: RunState) -> EtlRun {
    EtlRun {
        run_id: Uuid::parse_str(RUN_ID).unwrap(),
        state,
        queued_at: "2026-11-05T22:19:30.778Z".into(),
        started_at: None,
        finished_at: None,
        attempts: 0,
        error: None,
        steps: StepName::ALL
            .into_iter()
            .map(|name| EtlStep {
                name,
                state: StepState::Pending,
                attempts: 0,
                started_at: None,
                finished_at: None,
                error: None,
                output: None,
            })
            .collect(),
    }
}

pub fn storage_error() -> StorageError {
    StorageError {
        sqlstate: None,
        source: "conexión rechazada".into(),
    }
}
