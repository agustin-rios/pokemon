use std::sync::Arc;

use axum::Router;
use axum::routing::get;
use pokemon_context_pokedex::application::use_cases::{
    GetLevelClassificationByType, GetMonthlyCaptureGrowth, GetTopTrainersByRegion,
};

use super::reports_controller::{self, ReportsController};
use crate::modules::pokedex::PokedexRepositories;

/// Rutas de `/reports`, con sus casos de uso sobre el repositorio de reportes.
pub fn reports_module(pokedex: &PokedexRepositories) -> Router {
    let controller = Arc::new(ReportsController::new(
        GetMonthlyCaptureGrowth::new(Arc::clone(&pokedex.reports)),
        GetTopTrainersByRegion::new(Arc::clone(&pokedex.reports)),
        GetLevelClassificationByType::new(Arc::clone(&pokedex.reports)),
    ));
    Router::new()
        .route(
            "/reports/monthly-growth",
            get(reports_controller::monthly_growth),
        )
        .route(
            "/reports/top-trainers",
            get(reports_controller::top_trainers),
        )
        .route(
            "/reports/level-classification",
            get(reports_controller::level_classification),
        )
        .with_state(controller)
}
