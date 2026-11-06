//! Módulo raíz: junta el pool de la base y el módulo del ETL.

use pokemon_context_ingestion::domain::StorageError;
use sqlx::PgPool;
use thiserror::Error;

use crate::config::Config;
use crate::modules::database::database_module;
use crate::modules::etl::{EtlModule, etl_module};

/// No se pudo armar el worker.
#[derive(Debug, Error)]
pub enum AppModuleError {
    #[error("no se pudo conectar a la base de datos: {0}")]
    Database(#[source] sqlx::Error),
    #[error("no se pudo iniciar el worker: {0}")]
    Etl(#[source] StorageError),
}

/// Lo que compone el worker.
pub struct AppModule {
    pub pool: PgPool,
    pub etl: EtlModule,
}

impl AppModule {
    /// Conecta la base y arma el ETL.
    ///
    /// # Errors
    ///
    /// Falla si no se puede conectar a la base o abrir la conexión de escucha
    /// (`LISTEN etl_runs`).
    pub async fn create(config: &Config) -> Result<Self, AppModuleError> {
        let pool = database_module(&config.database_url)
            .await
            .map_err(AppModuleError::Database)?;
        let etl = etl_module(config, pool.clone())
            .await
            .map_err(AppModuleError::Etl)?;
        Ok(Self { pool, etl })
    }
}
