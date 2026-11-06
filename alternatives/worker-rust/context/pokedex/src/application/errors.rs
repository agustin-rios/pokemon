use thiserror::Error;

/// La entrada de un caso de uso no cumple sus reglas (la API la traduce a 400).
#[derive(Debug, Clone, PartialEq, Eq, Error)]
#[error("{0}")]
pub struct ValidationError(pub String);

/// Fallo de un repositorio, sin atarse al motor de base de datos.
#[derive(Debug, Error)]
pub enum RepositoryError {
    /// Falta una tabla o vista porque el pipeline todavía no cargó los datos
    /// (SQLSTATE `42P01`); la API lo traduce a 503.
    #[error("Los datos todavía no están cargados.")]
    DataNotLoaded,
    /// Cualquier otro fallo de la base de datos.
    #[error("error de base de datos: {0}")]
    Storage(#[source] Box<dyn std::error::Error + Send + Sync>),
}

/// Error de los casos de uso que validan su entrada y consultan el catálogo.
#[derive(Debug, Error)]
pub enum PokedexError {
    #[error(transparent)]
    Validation(#[from] ValidationError),
    #[error(transparent)]
    Repository(#[from] RepositoryError),
}
