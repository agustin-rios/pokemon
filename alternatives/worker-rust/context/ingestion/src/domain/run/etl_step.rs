use serde::Serialize;
use ts_rs::TS;

use super::step_name::StepName;
use super::step_state::StepState;

/// Un paso de una corrida.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct EtlStep {
    pub name: StepName,
    pub state: StepState,
    pub attempts: i32,
    /// Instante en UTC con el formato de la base: `2026-11-05T22:19:30.778Z`.
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub error: Option<String>,
    /// Resumen del paso (conteos, descartes); `null` si no tiene.
    #[ts(type = "unknown | null")]
    pub output: Option<serde_json::Value>,
}
