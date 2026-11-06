use std::sync::Arc;

use pokemon_context_pokedex::application::ports::{PokemonRepository, ReportsRepository};
use pokemon_context_pokedex::infra::adapters::{PgPokemonRepository, PgReportsRepository};
use sqlx::PgPool;

/// Los repositorios del contexto `pokedex` que consumen los módulos de la API.
#[derive(Clone)]
pub struct PokedexRepositories {
    pub pokemon: Arc<dyn PokemonRepository>,
    pub reports: Arc<dyn ReportsRepository>,
}

impl PokedexRepositories {
    /// Repositorios dados (adaptadores reales o stubs).
    pub fn new(pokemon: Arc<dyn PokemonRepository>, reports: Arc<dyn ReportsRepository>) -> Self {
        Self { pokemon, reports }
    }

    /// Los adaptadores de Postgres sobre `pool`.
    pub fn postgres(pool: &PgPool) -> Self {
        Self::new(
            Arc::new(PgPokemonRepository::new(pool.clone())),
            Arc::new(PgReportsRepository::new(pool.clone())),
        )
    }
}
