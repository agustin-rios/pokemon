use super::fence::Fence;

/// Corrida tomada por un worker.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClaimedRun {
    pub fence: Fence,
    pub max_attempts: i32,
}
