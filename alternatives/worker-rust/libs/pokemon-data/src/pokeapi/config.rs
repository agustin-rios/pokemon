use std::time::Duration;

/// Parámetros de red. Los valores por defecto son los del pipeline; los tests los acortan.
#[derive(Debug, Clone, Copy)]
pub struct ClientConfig {
    /// Tiempo máximo de cada petición (incluye leer el cuerpo).
    pub timeout: Duration,
    /// Peticiones por id, contando la primera.
    pub max_attempts: u32,
    /// Espera tras el primer fallo; se duplica en cada reintento.
    pub retry_base_delay: Duration,
    /// Peticiones simultáneas.
    pub concurrency: usize,
}

impl Default for ClientConfig {
    fn default() -> Self {
        Self {
            timeout: Duration::from_secs(15),
            max_attempts: 4,
            retry_base_delay: Duration::from_millis(500),
            concurrency: 8,
        }
    }
}
