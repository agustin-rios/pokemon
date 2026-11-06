//! Dominio: filas de `staging` con su validación, modelo de las corridas y errores.

pub mod dataset;
pub mod errors;
pub mod run;

pub use dataset::{
    BattleRecord, CaptureRecord, DataValidationError, LOAD_ORDER, PokemonRecord, PokemonTypeRecord,
    StagingDataset, TrainerRecord, TypeRecord, ValidationReport, validate_dataset,
};
pub use errors::{ErrorClass, StepError, StorageError, classify};
pub use run::{EtlRun, EtlStep, RunState, StepName, StepState};
