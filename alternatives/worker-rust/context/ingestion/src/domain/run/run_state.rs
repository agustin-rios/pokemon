use serde::Serialize;
use ts_rs::TS;

/// Estado de una corrida: `queued → running → succeeded | failed`; `running →
/// queued` ante un fallo reintentable y `failed → queued` en el reintento manual.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum RunState {
    Queued,
    Running,
    Succeeded,
    Failed,
}

impl RunState {
    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "queued" => Some(Self::Queued),
            "running" => Some(Self::Running),
            "succeeded" => Some(Self::Succeeded),
            "failed" => Some(Self::Failed),
            _ => None,
        }
    }
}
