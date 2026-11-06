use uuid::Uuid;

/// Qué pasó al intentar procesar una corrida.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProcessOutcome {
    /// No había corridas para tomar.
    Idle,
    Succeeded(Uuid),
    /// Fallo reintentable: la corrida volvió a la cola con espera.
    Requeued(Uuid),
    Failed(Uuid),
    /// Se perdió el lease: el worker dejó de ejecutar sin escribir nada más.
    LeaseLost(Uuid),
    /// Se pidió apagar: terminó el paso en curso y la corrida volvió a la cola
    /// (sin gastar un intento) para que otro worker la retome.
    Stopped(Uuid),
}
