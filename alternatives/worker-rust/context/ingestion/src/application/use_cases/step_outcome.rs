use serde_json::Value;

/// Resultado de ejecutar un paso.
#[derive(Debug, Clone, PartialEq)]
pub enum StepOutcome {
    /// Terminó bien, con su resumen (`null` si no tiene).
    Done(Option<Value>),
    /// El lease se perdió durante el paso: hay que dejar de ejecutar.
    LeaseLost,
}
