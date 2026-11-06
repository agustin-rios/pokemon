use std::sync::Arc;

use crate::application::ports::{Page, PageQuery, PokemonRepository};
use crate::application::{PokedexError, ValidationError};
use crate::domain::Pokemon;

pub const DEFAULT_PAGE_SIZE: i32 = 20;
pub const MAX_PAGE_SIZE: i32 = 100;

/// Parámetros opcionales de la lista; los que faltan toman su valor por defecto.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ListPokemonInput {
    pub page: Option<i32>,
    pub page_size: Option<i32>,
}

/// Lista paginada de Pokémon, ordenada por id.
pub struct ListPokemon {
    repository: Arc<dyn PokemonRepository>,
}

impl ListPokemon {
    pub fn new(repository: Arc<dyn PokemonRepository>) -> Self {
        Self { repository }
    }

    /// # Errors
    ///
    /// [`PokedexError::Validation`] si `page` < 1 o `page_size` fuera de
    /// 1..=[`MAX_PAGE_SIZE`]; también propaga los fallos del repositorio.
    pub async fn execute(&self, input: ListPokemonInput) -> Result<Page<Pokemon>, PokedexError> {
        let page = input.page.unwrap_or(1);
        let page_size = input.page_size.unwrap_or(DEFAULT_PAGE_SIZE);
        if page < 1 {
            return Err(ValidationError("page debe ser un entero ≥ 1".into()).into());
        }
        if !(1..=MAX_PAGE_SIZE).contains(&page_size) {
            return Err(ValidationError(format!(
                "pageSize debe ser un entero entre 1 y {MAX_PAGE_SIZE}"
            ))
            .into());
        }
        Ok(self.repository.list(PageQuery { page, page_size }).await?)
    }
}
