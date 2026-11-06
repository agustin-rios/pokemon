//! Módulo raíz: junta las rutas de todos los módulos.

use std::sync::Arc;

use axum::Router;
use pokemon_context_ingestion::application::ports::EtlRunQueue;

use crate::modules::etl::etl_module;
use crate::modules::health::health_module;
use crate::modules::items::items_module;
use crate::modules::pokedex::PokedexRepositories;
use crate::modules::reports::reports_module;

/// Las rutas de la API (sin el prefijo `/api`, que pone [`app_setup`](crate::app_setup)).
pub fn app_module(pokedex: &PokedexRepositories, queue: Arc<dyn EtlRunQueue>) -> Router {
    Router::new()
        .merge(health_module())
        .merge(items_module(pokedex))
        .merge(reports_module(pokedex))
        .merge(etl_module(queue))
}
