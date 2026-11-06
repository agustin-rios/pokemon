//! Servidor HTTP de mentira en proceso (axum) que imita `GET /pokemon/{id}` de PokeAPI.
#![allow(dead_code, clippy::unwrap_used)]

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use axum::Router;
use axum::extract::{Path, State};
use axum::http::{HeaderMap, HeaderName, HeaderValue, StatusCode};
use axum::response::IntoResponse;
use axum::routing::get;
use pokemon_data::pokeapi::ClientConfig;
use serde_json::{Value, json};

/// Qué responde el stub a una petición.
pub struct Reply {
    pub status: u16,
    pub headers: Vec<(&'static str, String)>,
    pub delay: Duration,
    pub body: String,
}

impl Reply {
    pub fn ok(id: u32) -> Self {
        Self::json(200, pokemon_json(id).to_string())
    }

    pub fn json(status: u16, body: String) -> Self {
        Self {
            status,
            headers: Vec::new(),
            delay: Duration::ZERO,
            body,
        }
    }

    pub fn status(status: u16) -> Self {
        Self::json(status, "{}".to_owned())
    }

    pub fn header(mut self, name: &'static str, value: impl Into<String>) -> Self {
        self.headers.push((name, value.into()));
        self
    }

    pub fn delayed(mut self, delay: Duration) -> Self {
        self.delay = delay;
        self
    }
}

/// Decide la respuesta según `(id, nº de petición de ese id, empezando en 1)`.
type Responder = Box<dyn Fn(u32, usize) -> Reply + Send + Sync>;

struct Inner {
    responder: Responder,
    hits: AtomicUsize,
    hits_by_id: std::sync::Mutex<std::collections::HashMap<u32, usize>>,
    in_flight: AtomicUsize,
    max_in_flight: AtomicUsize,
}

pub struct Stub {
    pub base_url: String,
    inner: Arc<Inner>,
}

impl Stub {
    pub async fn start(responder: impl Fn(u32, usize) -> Reply + Send + Sync + 'static) -> Self {
        let inner = Arc::new(Inner {
            responder: Box::new(responder),
            hits: AtomicUsize::new(0),
            hits_by_id: Default::default(),
            in_flight: AtomicUsize::new(0),
            max_in_flight: AtomicUsize::new(0),
        });
        let app = Router::new()
            .route("/api/v2/pokemon/{id}", get(handle))
            .with_state(Arc::clone(&inner));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        Self {
            base_url: format!("http://{addr}/api/v2"),
            inner,
        }
    }

    /// Peticiones recibidas en total.
    pub fn hits(&self) -> usize {
        self.inner.hits.load(Ordering::SeqCst)
    }

    /// Peticiones recibidas para un id.
    pub fn hits_for(&self, id: u32) -> usize {
        self.inner
            .hits_by_id
            .lock()
            .unwrap()
            .get(&id)
            .copied()
            .unwrap_or(0)
    }

    /// Máximo de peticiones atendiéndose a la vez.
    pub fn max_in_flight(&self) -> usize {
        self.inner.max_in_flight.load(Ordering::SeqCst)
    }

    pub fn url(&self, id: u32) -> String {
        format!("{}/pokemon/{id}", self.base_url)
    }
}

async fn handle(State(inner): State<Arc<Inner>>, Path(id): Path<u32>) -> impl IntoResponse {
    inner.hits.fetch_add(1, Ordering::SeqCst);
    let nth = {
        let mut by_id = inner.hits_by_id.lock().unwrap();
        let count = by_id.entry(id).or_default();
        *count += 1;
        *count
    };
    let now = inner.in_flight.fetch_add(1, Ordering::SeqCst) + 1;
    inner.max_in_flight.fetch_max(now, Ordering::SeqCst);
    let reply = (inner.responder)(id, nth);
    tokio::time::sleep(reply.delay).await;
    inner.in_flight.fetch_sub(1, Ordering::SeqCst);

    let mut headers = HeaderMap::new();
    headers.insert("content-type", HeaderValue::from_static("application/json"));
    for (name, value) in reply.headers {
        headers.insert(
            HeaderName::from_static(name),
            HeaderValue::from_str(&value).unwrap(),
        );
    }
    (
        StatusCode::from_u16(reply.status).unwrap(),
        headers,
        reply.body,
    )
}

/// Respuesta mínima válida de PokeAPI para un id.
pub fn pokemon_json(id: u32) -> Value {
    json!({
        "id": id,
        "name": format!("pokemon-{id}"),
        "height": 1,
        "weight": 2,
        "base_experience": 3,
        "sprites": { "front_default": format!("https://img/{id}.png") },
        "types": [{ "slot": 1, "type": { "name": "normal", "url": "https://pokeapi.co/api/v2/type/1/" } }],
    })
}

/// Configuración con esperas cortas para que los tests de reintentos sean rápidos.
pub fn fast_config() -> ClientConfig {
    ClientConfig {
        timeout: Duration::from_secs(5),
        retry_base_delay: Duration::from_millis(1),
        ..ClientConfig::default()
    }
}
