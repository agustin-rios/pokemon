use async_trait::async_trait;
use serde::Serialize;
use ts_rs::TS;

use crate::application::RepositoryError;
use crate::domain::Pokemon;

/// Pedido de una página del catálogo.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PageQuery {
    /// Desde 1.
    pub page: i32,
    pub page_size: i32,
}

/// Una página de resultados.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Page<T> {
    pub items: Vec<T>,
    pub total: i32,
    pub page: i32,
    pub page_size: i32,
}

/// Catálogo de Pokémon (Repository Pattern): los casos de uso dependen de este
/// contrato y no de cómo se guardan los datos. Implementación en `infra::adapters`.
#[async_trait]
pub trait PokemonRepository: Send + Sync {
    /// Ordenados por id, cada uno con sus tipos.
    async fn list(&self, query: PageQuery) -> Result<Page<Pokemon>, RepositoryError>;

    async fn find_by_id(&self, id: i32) -> Result<Option<Pokemon>, RepositoryError>;
}
