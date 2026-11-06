use std::sync::Arc;

use crate::application::ports::PokemonRepository;
use crate::application::{PokedexError, ValidationError};
use crate::domain::Pokemon;

/// Un Pokémon por id; `None` si no existe (la API lo traduce a 404).
pub struct GetPokemon {
    repository: Arc<dyn PokemonRepository>,
}

impl GetPokemon {
    pub fn new(repository: Arc<dyn PokemonRepository>) -> Self {
        Self { repository }
    }

    /// # Errors
    ///
    /// [`PokedexError::Validation`] si `id` es menor que 1; también propaga los
    /// fallos del repositorio.
    pub async fn execute(&self, id: i32) -> Result<Option<Pokemon>, PokedexError> {
        if id < 1 {
            return Err(ValidationError("id debe ser un entero ≥ 1".into()).into());
        }
        Ok(self.repository.find_by_id(id).await?)
    }
}
