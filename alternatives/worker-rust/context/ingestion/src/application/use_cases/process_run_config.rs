use std::time::Duration;

/// Parámetros del procesador.
#[derive(Debug, Clone)]
pub struct ProcessRunConfig {
    pub worker_id: String,
    /// Duración del lease; el heartbeat lo renueva cada tercio.
    pub lease: Duration,
    /// Plazo de cada paso: al vencer se cancela (sin escribir nada) y el fallo es reintentable.
    pub step_deadline: Duration,
}
