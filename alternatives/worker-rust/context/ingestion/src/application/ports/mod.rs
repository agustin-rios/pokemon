//! Puertos: lo que el pipeline necesita del mundo exterior. Implementaciones en `infra::adapters`.

mod claimed_run;
mod commit_outcome;
mod dataset_loader;
mod etl_run_queue;
mod failure_outcome;
mod fence;
mod pokemon_source;
mod run_notifier;
mod staging_store;
mod views_builder;

pub use claimed_run::ClaimedRun;
pub use commit_outcome::CommitOutcome;
pub use dataset_loader::DatasetLoader;
pub use etl_run_queue::EtlRunQueue;
pub use failure_outcome::FailureOutcome;
pub use fence::Fence;
pub use pokemon_source::PokemonSource;
pub use run_notifier::RunNotifier;
pub use staging_store::StagingStore;
pub use views_builder::ViewsBuilder;
