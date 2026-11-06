use uuid::Uuid;

/// Identifica una ejecución de una corrida: `attempts` es el token de fencing
/// que devolvió el claim, así un worker viejo no pisa a uno nuevo.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Fence {
    pub run_id: Uuid,
    pub worker_id: String,
    pub attempts: i32,
}
