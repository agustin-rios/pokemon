/// Cómo terminó el registro de un fallo.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FailureOutcome {
    /// Fallo reintentable con intentos disponibles: vuelve a la cola con espera.
    Requeued,
    /// La corrida quedó fallida.
    Failed,
    /// El lease se perdió: no se escribió nada.
    LeaseLost,
}
