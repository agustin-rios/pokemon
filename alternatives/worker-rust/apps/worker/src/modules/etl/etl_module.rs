use std::sync::Arc;

use pokemon_context_ingestion::application::use_cases::{
    BuildViews, GenerateData, LoadDataset, Pipeline, ProcessRun, ProcessRunConfig, ScrapeCatalog,
    ValidateDataset,
};
use pokemon_context_ingestion::domain::StorageError;
use pokemon_context_ingestion::infra::adapters::{
    PgDatasetLoader, PgEtlRunNotifier, PgEtlRunQueue, PgStagingStore, PgViewsBuilder, PokeApiSource,
};
use pokemon_data::pokeapi::PokeApiClient;
use sqlx::PgPool;

use crate::config::Config;

/// Lo que arma [`etl_module`]: el procesador de corridas y el notificador del NOTIFY.
pub struct EtlModule {
    pub process: ProcessRun,
    pub notifier: PgEtlRunNotifier,
}

/// Conecta los adaptadores reales a los casos de uso del ETL.
///
/// # Errors
///
/// Falla si no se puede abrir la conexión de escucha (`LISTEN etl_runs`).
pub async fn etl_module(config: &Config, pool: PgPool) -> Result<EtlModule, StorageError> {
    let staging = Arc::new(PgStagingStore::new(pool.clone()));
    let pipeline = Pipeline::new(
        ScrapeCatalog::new(
            Arc::new(PokeApiSource::new(PokeApiClient::new(&config.pokeapi_url))),
            staging.clone(),
            config.pokemon_limit,
        ),
        GenerateData::new(staging.clone()),
        ValidateDataset::new(staging.clone()),
        LoadDataset::new(staging, Arc::new(PgDatasetLoader::new(pool.clone()))),
        BuildViews::new(Arc::new(PgViewsBuilder::new(pool.clone()))),
    );
    let process = ProcessRun::new(
        Arc::new(PgEtlRunQueue::new(pool.clone())),
        pipeline,
        ProcessRunConfig {
            worker_id: config.worker_id.clone(),
            lease: config.lease,
            step_deadline: config.step_deadline,
        },
    );
    let notifier = PgEtlRunNotifier::connect(pool).await?;
    Ok(EtlModule { process, notifier })
}
