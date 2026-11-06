use serde::Serialize;
use ts_rs::TS;
use uuid::Uuid;

use super::etl_step::EtlStep;
use super::run_state::RunState;
use super::step_name::StepName;
use super::step_state::StepState;

/// Una corrida del pipeline con sus 5 pasos en orden.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct EtlRun {
    pub run_id: Uuid,
    pub state: RunState,
    /// `created_at` en UTC con el formato de la base.
    pub queued_at: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub attempts: i32,
    pub error: Option<String>,
    pub steps: Vec<EtlStep>,
}

impl EtlRun {
    /// Estado del paso `name`, si la corrida lo tiene.
    pub fn step_state(&self, name: StepName) -> Option<StepState> {
        self.steps.iter().find(|s| s.name == name).map(|s| s.state)
    }
}
