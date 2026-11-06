use serde::Serialize;
use ts_rs::TS;

/// Estado de un paso: `pending → running → succeeded | failed`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum StepState {
    Pending,
    Running,
    Succeeded,
    Failed,
}

impl StepState {
    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "pending" => Some(Self::Pending),
            "running" => Some(Self::Running),
            "succeeded" => Some(Self::Succeeded),
            "failed" => Some(Self::Failed),
            _ => None,
        }
    }
}
