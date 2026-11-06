/// Cómo terminó una escritura transaccional fenceada.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CommitOutcome {
    Committed,
    /// El lease se perdió antes del commit: se hizo rollback y no se cambió nada.
    LeaseLost,
}
