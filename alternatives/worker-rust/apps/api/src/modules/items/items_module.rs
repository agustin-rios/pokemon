use std::sync::Arc;

use axum::Router;
use axum::routing::get;
use pokemon_context_pokedex::application::use_cases::{GetPokemon, GetTypeSummary, ListPokemon};

use super::items_controller::{self, ItemsController};
use crate::modules::pokedex::PokedexRepositories;

/// Rutas de `/items`, con sus casos de uso sobre los repositorios del Pokédex.
pub fn items_module(pokedex: &PokedexRepositories) -> Router {
    let controller = Arc::new(ItemsController::new(
        ListPokemon::new(Arc::clone(&pokedex.pokemon)),
        GetPokemon::new(Arc::clone(&pokedex.pokemon)),
        GetTypeSummary::new(Arc::clone(&pokedex.reports)),
    ));
    Router::new()
        .route("/items", get(items_controller::list))
        // Antes de `:id`, aunque axum ya prioriza la ruta estática.
        .route("/items/summary", get(items_controller::summary))
        .route("/items/{id}", get(items_controller::find_one))
        .with_state(controller)
}
