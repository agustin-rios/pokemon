//! Modelo de una corrida del pipeline y de sus pasos: lo que expone la API.
//!
//! Los tipos derivan `TS` (sin `#[ts(export)]`) para que `gen-types` genere los
//! tipos de la web. Todo número expuesto es `i32` (un `i64` sería `bigint` en TS).

mod etl_run;
mod etl_step;
mod run_state;
mod step_name;
mod step_state;

pub use etl_run::EtlRun;
pub use etl_step::EtlStep;
pub use run_state::RunState;
pub use step_name::StepName;
pub use step_state::StepState;
