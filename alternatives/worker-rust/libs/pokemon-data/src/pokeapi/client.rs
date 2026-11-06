use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::Duration;

use chrono::{DateTime, Utc};
use reqwest::header::{HeaderMap, RETRY_AFTER};
use tokio::task::JoinSet;

use super::MAX_POKEMON;
use super::config::ClientConfig;
use super::error::{AttemptFailure, PokeApiError};
use crate::dataset::{ApiPokemon, Dataset};

/// Resultado de una petición que llegó a recibir respuesta.
enum Reply {
    Body(Vec<u8>),
    Rejected {
        status: u16,
        retry_after: Option<Duration>,
    },
}

#[derive(Debug, Clone)]
pub struct PokeApiClient {
    http: reqwest::Client,
    base_url: String,
    config: ClientConfig,
}

impl PokeApiClient {
    pub fn new(base_url: impl Into<String>) -> Self {
        Self::with_config(base_url, ClientConfig::default())
    }

    pub fn with_config(base_url: impl Into<String>, config: ClientConfig) -> Self {
        let base_url: String = base_url.into();
        Self {
            http: reqwest::Client::new(),
            base_url: base_url.trim_end_matches('/').to_owned(),
            config: ClientConfig {
                max_attempts: config.max_attempts.max(1),
                concurrency: config.concurrency.max(1),
                ..config
            },
        }
    }

    /// Descarga los Pokémon `1..=limit` y los convierte al catálogo. Soltar el future
    /// cancela las peticiones en curso.
    pub async fn scrape(&self, limit: u32) -> Result<Dataset, PokeApiError> {
        Dataset::from_api(&self.fetch_pokemon(limit).await?)
    }

    /// Descarga los Pokémon `1..=limit`, en orden de id. La primera falla aborta el resto
    /// y es la que se informa.
    pub async fn fetch_pokemon(&self, limit: u32) -> Result<Vec<ApiPokemon>, PokeApiError> {
        if limit > MAX_POKEMON {
            return Err(PokeApiError::InvalidLimit);
        }
        let next_id = Arc::new(AtomicU32::new(1));
        let mut workers = JoinSet::new();
        for _ in 0..self.config.concurrency.min(limit as usize) {
            let client = self.clone();
            let next_id = Arc::clone(&next_id);
            workers.spawn(async move {
                let mut fetched = Vec::new();
                // Cada worker toma el siguiente id pendiente hasta agotarlos.
                loop {
                    let id = next_id.fetch_add(1, Ordering::Relaxed);
                    if id > limit {
                        return Ok(fetched);
                    }
                    let url = format!("{}/pokemon/{id}", client.base_url);
                    fetched.push((id, client.get_pokemon(&url).await?));
                }
            });
        }

        let mut results = Vec::with_capacity(limit as usize);
        while let Some(joined) = workers.join_next().await {
            match joined {
                Ok(Ok(fetched)) => results.extend(fetched),
                // Al retornar se suelta el JoinSet y se abortan los demás workers.
                Ok(Err(err)) => return Err(err),
                Err(err) if err.is_panic() => std::panic::resume_unwind(err.into_panic()),
                Err(_) => {}
            }
        }
        results.sort_by_key(|(id, _)| *id);
        Ok(results.into_iter().map(|(_, pokemon)| pokemon).collect())
    }

    /// GET con timeout; reintenta solo errores de red, timeouts, 429 y 5xx.
    async fn get_pokemon(&self, url: &str) -> Result<ApiPokemon, PokeApiError> {
        let mut attempt = 0;
        loop {
            let (failure, retry_after) = match self.send(url).await {
                Ok(Reply::Body(body)) => {
                    return serde_json::from_slice(&body).map_err(|source| PokeApiError::Decode {
                        url: url.to_owned(),
                        source,
                    });
                }
                Ok(Reply::Rejected {
                    status,
                    retry_after,
                }) => {
                    if status != 429 && status < 500 {
                        return Err(PokeApiError::Status {
                            url: url.to_owned(),
                            status,
                        });
                    }
                    (AttemptFailure::Status(status), retry_after)
                }
                Err(err) => (AttemptFailure::Network(err), None),
            };

            attempt += 1;
            if attempt >= self.config.max_attempts {
                return Err(PokeApiError::Exhausted {
                    url: url.to_owned(),
                    attempts: attempt,
                    last: failure,
                });
            }
            // Un `Retry-After` solo existe en respuestas HTTP y reemplaza la espera.
            tokio::time::sleep(retry_after.unwrap_or_else(|| self.backoff(attempt - 1))).await;
        }
    }

    /// Una petición: falla solo por red o timeout; cualquier respuesta HTTP es un [`Reply`].
    async fn send(&self, url: &str) -> Result<Reply, reqwest::Error> {
        let response = self
            .http
            .get(url)
            .timeout(self.config.timeout)
            .send()
            .await?;
        let status = response.status();
        if status.is_success() {
            Ok(Reply::Body(response.bytes().await?.to_vec()))
        } else {
            Ok(Reply::Rejected {
                status: status.as_u16(),
                retry_after: retry_after(response.headers()),
            })
        }
    }

    /// `500 ms × 2^intento` con la base configurada.
    fn backoff(&self, attempt: u32) -> Duration {
        self.config
            .retry_base_delay
            .saturating_mul(2u32.saturating_pow(attempt))
    }
}

/// `Retry-After` numérico (segundos ≥ 0) o fecha HTTP (`max(0, fecha - ahora)`).
fn retry_after(headers: &HeaderMap) -> Option<Duration> {
    let raw = headers.get(RETRY_AFTER)?.to_str().ok()?;
    if let Ok(seconds) = raw.trim().parse::<f64>()
        && seconds.is_finite()
        && seconds >= 0.0
    {
        return Duration::try_from_secs_f64(seconds).ok();
    }
    let date = DateTime::parse_from_rfc2822(raw.trim()).ok()?;
    let wait = date.with_timezone(&Utc) - Utc::now();
    Some(wait.to_std().unwrap_or(Duration::ZERO))
}
