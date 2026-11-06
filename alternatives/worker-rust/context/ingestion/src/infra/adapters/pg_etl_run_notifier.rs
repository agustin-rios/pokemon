use std::time::Duration;

use async_trait::async_trait;
use sqlx::PgPool;
use sqlx::postgres::PgListener;
use tokio::sync::Mutex;
use tokio::time::{sleep, timeout};
use tracing::warn;
use uuid::Uuid;

use super::storage_error;
use crate::application::ports::RunNotifier;
use crate::domain::StorageError;

const CHANNEL: &str = "etl_runs";

/// `LISTEN etl_runs` en una conexión propia (fuera del pool de consultas).
/// Si se cae, se reconecta en la próxima espera; mientras tanto el sondeo del
/// worker garantiza el avance.
pub struct PgEtlRunNotifier {
    pool: PgPool,
    listener: Mutex<Option<PgListener>>,
}

impl PgEtlRunNotifier {
    /// Abre la conexión y empieza a escuchar.
    ///
    /// # Errors
    ///
    /// Falla si no se puede conectar o ejecutar `LISTEN`.
    pub async fn connect(pool: PgPool) -> Result<Self, StorageError> {
        let listener = Self::listen(&pool).await?;
        Ok(Self {
            pool,
            listener: Mutex::new(Some(listener)),
        })
    }

    async fn listen(pool: &PgPool) -> Result<PgListener, StorageError> {
        let mut listener = PgListener::connect_with(pool)
            .await
            .map_err(storage_error)?;
        listener.listen(CHANNEL).await.map_err(storage_error)?;
        Ok(listener)
    }
}

#[async_trait]
impl RunNotifier for PgEtlRunNotifier {
    async fn wait(&self, wait: Duration) -> Option<Uuid> {
        let mut guard = self.listener.lock().await;
        if guard.is_none() {
            match Self::listen(&self.pool).await {
                Ok(listener) => *guard = Some(listener),
                Err(e) => {
                    warn!("no se pudo reconectar el LISTEN de {CHANNEL}: {e}");
                    sleep(wait).await;
                    return None;
                }
            }
        }
        let listener = guard.as_mut()?;
        match timeout(wait, listener.recv()).await {
            Ok(Ok(notification)) => notification.payload().parse().ok(),
            Ok(Err(e)) => {
                warn!("se cayó el LISTEN de {CHANNEL}: {e}");
                *guard = None;
                None
            }
            Err(_) => None,
        }
    }
}
